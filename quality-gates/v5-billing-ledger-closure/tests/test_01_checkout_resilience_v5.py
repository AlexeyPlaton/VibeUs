from __future__ import annotations

import inspect
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select


class FakeResponse:
    def __init__(self, payload, status_code=201):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload


class RecordingHTTPClient:
    def __init__(self, payload, calls):
        self.payload = payload
        self.calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return FakeResponse(self.payload)


class CaptureDB:
    def __init__(self):
        self.added = []
        self.commit_calls = 0
        self.rollback_calls = 0

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commit_calls += 1

    async def rollback(self):
        self.rollback_calls += 1


@pytest.fixture
def configured_yoo(monkeypatch, service_modules):
    svc = service_modules.yookassa_service
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
@pytest.mark.parametrize(
    "provider_payload",
    [
        {"id": "yk-v5-no-confirm", "status": "pending", "confirmation": {}},
        {"status": "pending", "confirmation": {"confirmation_url": "https://yookassa.ru/checkout/v5"}},
        {"id": "", "status": "pending", "confirmation": {"confirmation_url": "https://yookassa.ru/checkout/v5"}},
        {"id": "yk-v5-http-confirm", "status": "pending", "confirmation": {"confirmation_url": "http://yookassa.ru/checkout/v5"}},
    ],
)
async def test_redirect_checkout_rejects_incomplete_provider_2xx_before_local_success(
    configured_yoo, monkeypatch, provider_payload
):
    calls = []
    monkeypatch.setattr(
        configured_yoo.httpx,
        "AsyncClient",
        lambda *a, **k: RecordingHTTPClient(provider_payload, calls),
    )
    db = CaptureDB()

    with pytest.raises(HTTPException) as exc:
        await configured_yoo.create_yookassa_payment(
            workspace_id="ws-v5-provider-shape",
            owner_email="owner@example.test",
            tier="solo",
            return_url="https://vibeus.pro/app",
            db=db,
        )

    assert exc.value.status_code >= 500
    assert db.added == [], "Malformed provider success must not become a local pending Payment."
    assert db.commit_calls == 0


@pytest.mark.blocker
@pytest.mark.billing
def test_checkout_api_exposes_caller_idempotency_key_to_service(project_root):
    main = (project_root / "openspec-core" / "main.py").read_text(encoding="utf-8")
    start = main.find("@app.post('/api/billing/yookassa/create-payment')")
    assert start >= 0
    block = main[start:start + 3500]
    assert "Idempotency-Key" in block, (
        "Checkout endpoint must accept a caller Idempotency-Key so the same HTTP/business retry can reuse the same provider operation."
    )
    assert "idempotency_key=" in block, "Caller idempotency key must be passed to yookassa_service."


@pytest.mark.blocker
@pytest.mark.billing
@pytest.mark.asyncio
async def test_same_checkout_idempotency_key_returns_one_local_payment(
    fresh_backend, monkeypatch
):
    rt = fresh_backend
    svc = rt.main.yookassa_service
    sig = inspect.signature(svc.create_yookassa_payment)
    assert "idempotency_key" in sig.parameters, (
        "create_yookassa_payment must accept an explicit caller/business idempotency_key; a fresh uuid4 per call is not retry-safe."
    )

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
            yookassa_vat_code="",
            yookassa_payment_subject="",
            enable_mock_billing=False,
        ),
    )
    monkeypatch.setattr(
        svc.pricing,
        "public_catalog",
        lambda: {"markets": {"ru": {"plans": {"solo": {"amount": "1490.00"}}}}},
    )
    monkeypatch.setattr(svc.pricing, "amount_minor", lambda market, tier: 149000)

    provider = {
        "id": "yk-v5-idempotent",
        "status": "pending",
        "confirmation": {"confirmation_url": "https://yookassa.ru/checkout/v5-idempotent"},
    }
    calls = []
    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda *a, **k: RecordingHTTPClient(provider, calls))

    async with rt.database.async_session() as db:
        ws = rt.models.Workspace(name="Idempotent WS", owner_email="idempotent@example.test")
        db.add(ws)
        await db.commit()
        ws_id = ws.id

    key = "checkout-v5-001"
    results = []
    for _ in range(2):
        async with rt.database.async_session() as db:
            results.append(
                await svc.create_yookassa_payment(
                    workspace_id=ws_id,
                    owner_email="idempotent@example.test",
                    tier="solo",
                    return_url="https://vibeus.pro/app",
                    db=db,
                    idempotency_key=key,
                )
            )

    assert [kwargs["headers"]["Idempotence-Key"] for _, kwargs in calls] == [key, key]
    assert results[0]["payment_id"] == results[1]["payment_id"] == provider["id"]
    assert results[0]["confirmation_url"] == results[1]["confirmation_url"]

    async with rt.database.async_session() as db:
        count = (await db.execute(
            select(func.count(rt.models.Payment.id)).where(rt.models.Payment.provider_payment_id == provider["id"])
        )).scalar_one()
    assert count == 1, "Same provider operation must map to exactly one local Payment row."
