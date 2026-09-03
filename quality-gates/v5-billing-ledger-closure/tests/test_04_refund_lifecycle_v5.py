from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import UniqueConstraint, func, select


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload


class RefundHTTPClient:
    def __init__(self, remote_refund, urls):
        self.remote_refund = remote_refund
        self.urls = urls

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, **kwargs):
        self.urls.append(url)
        assert "/refunds/" in url, (
            "refund.succeeded must be authenticated against the refund resource; refund object id is not a payment id."
        )
        return FakeResponse(self.remote_refund)


@pytest.mark.blocker
@pytest.mark.billing
@pytest.mark.fiscal
def test_refund_has_dedicated_durable_ledger_model(service_modules):
    models = service_modules.models
    assert hasattr(models, "PaymentRefund"), "Add a durable PaymentRefund ledger; one Payment may have multiple/partial refunds."
    Refund = models.PaymentRefund
    cols = {c.name for c in Refund.__table__.columns}
    required = {"provider_refund_id", "payment_id", "amount_minor", "currency", "status"}
    assert required.issubset(cols), f"PaymentRefund missing: {sorted(required - cols)}"
    provider_col = Refund.__table__.columns["provider_refund_id"]
    has_unique_constraint = any(
        isinstance(cons, UniqueConstraint)
        and [c.name for c in cons.columns] == [provider_col.name]
        for cons in Refund.__table__.constraints
    )
    assert provider_col.unique is True or has_unique_constraint, "provider_refund_id must be unique/idempotent."


async def _seed_paid_npdpayment(rt, provider_payment_id: str, amount_minor: int = 149000):
    async with rt.database.async_session() as db:
        ws = rt.models.Workspace(name="Refund WS", owner_email="refund@example.test")
        db.add(ws)
        await db.flush()
        kwargs = dict(
            provider="yookassa",
            provider_payment_id=provider_payment_id,
            workspace_id=ws.id,
            plan="solo",
            amount_minor=amount_minor,
            currency="RUB",
            status="succeeded",
            tax_mode="npd",
            fiscal_status="receipt_issued",
            receipt_url="https://lknpd.nalog.ru/api/v1/receipt/refund-test/print",
            receipt_issued_at=rt.models.utcnow(),
            buyer_email="refund@example.test",
            buyer_is_b2b=False,
            is_test=False,
        )
        if "buyer_snapshot_verified" in {c.name for c in rt.models.Payment.__table__.columns}:
            kwargs["buyer_snapshot_verified"] = True
        payment = rt.models.Payment(**kwargs)
        db.add(payment)
        await db.commit()
        return payment.id


@pytest.fixture
def configured_refunds(fresh_backend, monkeypatch):
    rt = fresh_backend
    svc = rt.main.yookassa_service
    monkeypatch.setattr(svc, "YOOKASSA_SHOP_ID", "shop-v5")
    monkeypatch.setattr(svc, "YOOKASSA_SECRET_KEY", "secret-v5")
    monkeypatch.setattr(svc, "ALLOW_MOCK_BILLING", False)
    monkeypatch.setattr(svc, "_allow_mock_billing", lambda: False)
    monkeypatch.setattr(
        svc,
        "get_settings",
        lambda: SimpleNamespace(
            billing_tax_mode="npd",
            billing_period_days=30,
            environment="test",
            enable_mock_billing=False,
        ),
    )
    return rt, svc


@pytest.mark.blocker
@pytest.mark.billing
@pytest.mark.fiscal
@pytest.mark.asyncio
async def test_full_refund_is_verified_idempotent_and_requires_npd_receipt_reconciliation(
    configured_refunds, monkeypatch
):
    rt, svc = configured_refunds
    provider_payment_id = "yk-v5-full-refund"
    payment_id = await _seed_paid_npdpayment(rt, provider_payment_id)
    refund = {
        "id": "rf-v5-full",
        "status": "succeeded",
        "payment_id": provider_payment_id,
        "amount": {"value": "1490.00", "currency": "RUB"},
    }
    urls = []
    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda *a, **k: RefundHTTPClient(refund, urls))

    for _ in range(2):
        async with rt.database.async_session() as db:
            result = await svc.process_yookassa_webhook(
                {"event": "refund.succeeded", "object": refund}, db
            )
            assert result.get("status") in {"ok", "processed"}

    assert urls and all("/refunds/" in url for url in urls)
    async with rt.database.async_session() as db:
        payment = (await db.execute(
            select(rt.models.Payment).where(rt.models.Payment.id == payment_id)
        )).scalar_one()
        refunds = (await db.execute(
            select(func.count(rt.models.PaymentRefund.id)).where(
                rt.models.PaymentRefund.provider_refund_id == refund["id"]
            )
        )).scalar_one()

    assert refunds == 1, "Duplicate refund webhook must not duplicate local refund ledger."
    assert payment.status == "refunded", "A verified full refund must be visible in the local payment ledger."
    assert payment.fiscal_status == "receipt_refund_required", (
        "Refunding money does not itself prove that the NPD receipt was annulled/corrected in 'Мой налог'."
    )


@pytest.mark.blocker
@pytest.mark.billing
@pytest.mark.asyncio
async def test_forged_refund_event_does_not_write_when_verified_refund_is_not_succeeded(
    configured_refunds, monkeypatch
):
    rt, svc = configured_refunds
    provider_payment_id = "yk-v5-refund-pending"
    payment_id = await _seed_paid_npdpayment(rt, provider_payment_id)
    webhook_refund = {
        "id": "rf-v5-pending",
        "status": "succeeded",
        "payment_id": provider_payment_id,
        "amount": {"value": "1490.00", "currency": "RUB"},
    }
    remote_refund = dict(webhook_refund, status="pending")
    urls = []
    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda *a, **k: RefundHTTPClient(remote_refund, urls))

    async with rt.database.async_session() as db:
        try:
            result = await svc.process_yookassa_webhook(
                {"event": "refund.succeeded", "object": webhook_refund}, db
            )
            assert result.get("status") == "ignored"
        except Exception as exc:
            status_code = getattr(exc, "status_code", None)
            assert status_code in {400, 409}, f"Unexpected refund verification failure: {exc!r}"

    async with rt.database.async_session() as db:
        payment = (await db.execute(
            select(rt.models.Payment).where(rt.models.Payment.id == payment_id)
        )).scalar_one()
        count = (await db.execute(select(func.count(rt.models.PaymentRefund.id)))).scalar_one()
    assert payment.status == "succeeded"
    assert count == 0


@pytest.mark.blocker
@pytest.mark.billing
@pytest.mark.fiscal
@pytest.mark.asyncio
async def test_partial_refunds_accumulate_without_premature_full_refund(
    configured_refunds, monkeypatch
):
    rt, svc = configured_refunds
    provider_payment_id = "yk-v5-partial-refunds"
    payment_id = await _seed_paid_npdpayment(rt, provider_payment_id)
    current = {"refund": None}
    urls = []
    monkeypatch.setattr(
        svc.httpx,
        "AsyncClient",
        lambda *a, **k: RefundHTTPClient(current["refund"], urls),
    )

    first = {
        "id": "rf-v5-part-1",
        "status": "succeeded",
        "payment_id": provider_payment_id,
        "amount": {"value": "490.00", "currency": "RUB"},
    }
    current["refund"] = first
    async with rt.database.async_session() as db:
        result = await svc.process_yookassa_webhook({"event": "refund.succeeded", "object": first}, db)
        assert result.get("status") in {"ok", "processed"}

    async with rt.database.async_session() as db:
        payment = (await db.execute(select(rt.models.Payment).where(rt.models.Payment.id == payment_id))).scalar_one()
        count = (await db.execute(select(func.count(rt.models.PaymentRefund.id)))).scalar_one()
    assert count == 1
    assert payment.status == "succeeded", "A partial refund must not masquerade as a full refund."
    assert payment.fiscal_status == "receipt_refund_required"

    second = {
        "id": "rf-v5-part-2",
        "status": "succeeded",
        "payment_id": provider_payment_id,
        "amount": {"value": "1000.00", "currency": "RUB"},
    }
    current["refund"] = second
    async with rt.database.async_session() as db:
        result = await svc.process_yookassa_webhook({"event": "refund.succeeded", "object": second}, db)
        assert result.get("status") in {"ok", "processed"}

    async with rt.database.async_session() as db:
        payment = (await db.execute(select(rt.models.Payment).where(rt.models.Payment.id == payment_id))).scalar_one()
        count = (await db.execute(select(func.count(rt.models.PaymentRefund.id)))).scalar_one()
    assert count == 2
    assert payment.status == "refunded", "Cumulative successful refunds equal to full amount must close the local payment as refunded."


@pytest.mark.blocker
@pytest.mark.fiscal
def test_operator_refund_fiscal_reconciliation_exists(receipt_module):
    assert hasattr(receipt_module, "reconcile_refunded_receipt"), (
        "Add operator-side reconciliation after the actual 'Мой налог' annulment/correction; provider refund alone is insufficient."
    )
