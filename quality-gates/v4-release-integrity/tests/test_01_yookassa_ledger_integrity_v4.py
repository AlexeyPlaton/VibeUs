from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload


class FakeHTTPClient:
    def __init__(self, *, post_payload=None, get_payload=None):
        self.post_payload = post_payload
        self.get_payload = get_payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
        return FakeResponse(self.post_payload)

    async def get(self, *args, **kwargs):
        return FakeResponse(self.get_payload)


class CaptureDB:
    def __init__(self, *, fail_commit=False):
        self.added = []
        self.fail_commit = fail_commit
        self.commit_calls = 0
        self.rollback_calls = 0

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commit_calls += 1
        if self.fail_commit:
            raise RuntimeError("simulated ledger commit failure")

    async def rollback(self):
        self.rollback_calls += 1


class ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class WebhookDB:
    def __init__(self, payment):
        self.payment = payment
        self.commit_calls = 0

    async def execute(self, _stmt):
        return ScalarResult(self.payment)

    async def commit(self):
        self.commit_calls += 1


@pytest.fixture
def configured_yoo(monkeypatch, service_modules):
    svc = service_modules.yookassa_service
    monkeypatch.setattr(svc, "YOOKASSA_SHOP_ID", "shop-v4")
    monkeypatch.setattr(svc, "YOOKASSA_SECRET_KEY", "secret-v4")
    monkeypatch.setattr(svc, "ALLOW_MOCK_BILLING", False)
    monkeypatch.setattr(svc, "_allow_mock_billing", lambda: False)
    monkeypatch.setattr(
        svc,
        "get_settings",
        lambda: SimpleNamespace(
            billing_tax_mode="npd",
            billing_period_days=30,
            environment="test",
            yookassa_vat_code="",
            yookassa_payment_subject="",
            enable_mock_billing=False,
        ),
    )
    monkeypatch.setattr(
        svc.pricing,
        "public_catalog",
        lambda: {"markets": {"ru": {"plans": {"solo": {"amount": "1490.00"}, "studio": {"amount": "4990.00"}}}}},
    )
    monkeypatch.setattr(svc.pricing, "amount_minor", lambda market, tier: 149000 if tier == "solo" else 499000)
    return svc


@pytest.mark.blocker
@pytest.mark.billing
@pytest.mark.asyncio
async def test_real_checkout_never_returns_confirmation_if_local_ledger_commit_fails(
    configured_yoo, monkeypatch
):
    svc = configured_yoo
    provider = {
        "id": "yk-v4-real-ledger-fail",
        "status": "pending",
        "confirmation": {"confirmation_url": "https://yookassa.ru/checkout/v4-ledger-fail"},
    }
    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda *a, **k: FakeHTTPClient(post_payload=provider))
    db = CaptureDB(fail_commit=True)

    with pytest.raises(HTTPException) as exc:
        await svc.create_yookassa_payment(
            workspace_id="ws-v4",
            owner_email="owner@example.test",
            tier="solo",
            return_url="https://vibeus.pro/app",
            db=db,
        )

    assert exc.value.status_code >= 500
    assert db.rollback_calls >= 1, "A failed ledger transaction must be rolled back before the session is reused."
    assert db.added, "The implementation must attempt to persist the server-side intent before declaring checkout success."


@pytest.mark.blocker
@pytest.mark.billing
@pytest.mark.asyncio
async def test_mock_checkout_also_fails_closed_when_ledger_commit_fails(service_modules, monkeypatch):
    """Mock mode is part of the release harness; it must not produce false-green checkouts without a ledger."""
    svc = service_modules.yookassa_service
    monkeypatch.setattr(svc, "YOOKASSA_SHOP_ID", "")
    monkeypatch.setattr(svc, "YOOKASSA_SECRET_KEY", "")
    monkeypatch.setattr(svc, "ALLOW_MOCK_BILLING", True)
    monkeypatch.setattr(
        svc,
        "get_settings",
        lambda: SimpleNamespace(
            billing_tax_mode="npd",
            billing_period_days=30,
            environment="test",
            enable_mock_billing=True,
        ),
    )
    monkeypatch.setattr(
        svc.pricing,
        "public_catalog",
        lambda: {"markets": {"ru": {"plans": {"solo": {"amount": "1490.00"}, "studio": {"amount": "4990.00"}}}}},
    )
    monkeypatch.setattr(svc.pricing, "amount_minor", lambda market, tier: 149000)
    db = CaptureDB(fail_commit=True)

    with pytest.raises(HTTPException):
        await svc.create_yookassa_payment(
            workspace_id="ws-v4-mock",
            owner_email="owner@example.test",
            tier="solo",
            return_url="https://vibeus.pro/app",
            db=db,
        )
    assert db.rollback_calls >= 1


@pytest.mark.blocker
@pytest.mark.security
@pytest.mark.billing
@pytest.mark.asyncio
async def test_forged_canceled_event_cannot_mutate_ledger_when_provider_status_is_not_canceled(
    configured_yoo, monkeypatch
):
    svc = configured_yoo
    payment = SimpleNamespace(
        provider_payment_id="yk-v4-cancel-auth",
        status="pending",
        amount_minor=149000,
        currency="RUB",
        tax_mode="npd",
        fiscal_status="receipt_not_required",
    )
    db = WebhookDB(payment)
    remote = {"id": payment.provider_payment_id, "status": "pending", "test": False}
    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda *a, **k: FakeHTTPClient(get_payload=remote))

    try:
        result = await svc.process_yookassa_webhook(
            {"event": "payment.canceled", "object": {"id": payment.provider_payment_id}}, db
        )
        assert result.get("status") in {"ignored", "ok"}
    except HTTPException as exc:
        assert exc.status_code in {400, 409}, "A verified provider-state mismatch may be rejected, but never applied."

    assert payment.status == "pending", "Webhook event name alone must not cancel a payment."
    assert db.commit_calls == 0, "No local cancellation may be committed unless provider status is canceled."


@pytest.mark.blocker
@pytest.mark.billing
@pytest.mark.asyncio
async def test_verified_provider_canceled_status_still_transitions_payment(configured_yoo, monkeypatch):
    """Prevents a lazy fix that simply deletes/ignores the cancellation path."""
    svc = configured_yoo
    payment = SimpleNamespace(
        provider_payment_id="yk-v4-cancel-valid",
        status="pending",
        amount_minor=149000,
        currency="RUB",
        tax_mode="npd",
        fiscal_status="receipt_not_required",
    )
    db = WebhookDB(payment)
    remote = {"id": payment.provider_payment_id, "status": "canceled", "test": False}
    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda *a, **k: FakeHTTPClient(get_payload=remote))

    result = await svc.process_yookassa_webhook(
        {"event": "payment.canceled", "object": {"id": payment.provider_payment_id}}, db
    )
    assert result.get("status") in {"ok", "processed"}
    assert payment.status == "canceled"
    assert db.commit_calls == 1


@pytest.mark.blocker
@pytest.mark.billing
@pytest.mark.asyncio
async def test_buyer_fiscal_identity_is_snapshotted_on_payment(configured_yoo, service_modules, monkeypatch):
    svc = configured_yoo
    Payment = service_modules.models.Payment
    required_columns = {"buyer_email", "buyer_is_b2b", "buyer_inn", "buyer_name"}
    actual_columns = {c.name for c in Payment.__table__.columns}
    assert required_columns.issubset(actual_columns), (
        "Buyer/fiscal identity must be durable Payment data, not mutable Workspace data. "
        f"Missing: {sorted(required_columns - actual_columns)}"
    )

    provider = {
        "id": "yk-v4-buyer-snapshot",
        "status": "pending",
        "confirmation": {"confirmation_url": "https://yookassa.ru/checkout/v4-buyer"},
    }
    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda *a, **k: FakeHTTPClient(post_payload=provider))
    db = CaptureDB()
    result = await svc.create_yookassa_payment(
        workspace_id="ws-v4-buyer",
        owner_email="billing-at-checkout@example.test",
        tier="solo",
        return_url="https://vibeus.pro/app",
        is_b2b=True,
        company_inn="7701234567",
        company_name='ООО "Покупатель на момент оплаты"',
        db=db,
    )
    assert result["payment_id"] == provider["id"]
    assert len(db.added) == 1
    payment = db.added[0]
    assert payment.buyer_email == "billing-at-checkout@example.test"
    assert payment.buyer_is_b2b is True
    assert payment.buyer_inn == "7701234567"
    assert payment.buyer_name == 'ООО "Покупатель на момент оплаты"'


class ReceiptRowsResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class ReceiptListDB:
    def __init__(self, rows):
        self.rows = rows

    async def execute(self, _stmt):
        return ReceiptRowsResult(self.rows)


@pytest.mark.blocker
@pytest.mark.billing
@pytest.mark.asyncio
async def test_receipt_operator_list_uses_payment_snapshot_not_mutated_workspace(receipt_module, capsys):
    manage = receipt_module
    payment = SimpleNamespace(
        id="pay-v4-snapshot",
        provider_payment_id="yk-v4-snapshot",
        amount_minor=149000,
        currency="RUB",
        processed_at=None,
        created_at="2026-09-02T00:00:00",
        buyer_email="snapshot@example.test",
        buyer_is_b2b=True,
        buyer_inn="7701234567",
        buyer_name='ООО "Snapshot Buyer"',
    )
    # Deliberately different current workspace fields: these must NOT rewrite history.
    workspace = SimpleNamespace(
        id="ws-v4-snapshot",
        owner_email="mutated@example.test",
        company_inn="9999999999",
        company_name="MUTATED WORKSPACE",
    )
    await manage.list_receipts(ReceiptListDB([(payment, workspace)]))
    out = capsys.readouterr().out
    assert "snapshot@example.test" in out
    assert "7701234567" in out
    assert "Snapshot Buyer" in out
    assert "mutated@example.test" not in out
    assert "9999999999" not in out
    assert "MUTATED WORKSPACE" not in out
