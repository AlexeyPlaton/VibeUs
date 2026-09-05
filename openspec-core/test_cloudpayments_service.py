from types import SimpleNamespace

import pytest
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import cloudpayments_service
import models


SECRET = "test-cloudpayments-secret"


def fake_settings():
    return SimpleNamespace(
        cloudpayments_api_secret=SecretStr(SECRET),
        billing_period_days=30,
    )


def signed_headers(body: bytes) -> dict[str, str]:
    return {"Content-HMAC": cloudpayments_service._signature(body, SECRET)}


def test_cloudpayments_hmac_rejects_tampering(monkeypatch):
    monkeypatch.setattr(cloudpayments_service, "get_settings", fake_settings)
    body = b"InvoiceId=inv-1&Amount=29.00&Currency=USD"
    headers = signed_headers(body)
    assert cloudpayments_service.verify_notification_hmac(body, headers)
    assert not cloudpayments_service.verify_notification_hmac(
        b"InvoiceId=inv-1&Amount=1.00&Currency=USD", headers
    )


@pytest.mark.asyncio
async def test_duplicate_pay_notification_does_not_extend_entitlement_twice(monkeypatch):
    monkeypatch.setattr(cloudpayments_service, "get_settings", fake_settings)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    body = (
        b"InvoiceId=inv-1&AccountId=ws-1&Amount=29.00&Currency=USD"
        b"&TransactionId=777"
    )
    headers = signed_headers(body)

    async with Session() as db:
        workspace = models.Workspace(
            id="ws-1",
            name="Workspace",
            owner_email="owner@example.com",
            subscription_tier="free",
            subscription_status="inactive",
        )
        payment = models.Payment(
            id="pay-1",
            provider="cloudpayments",
            provider_payment_id="inv-1",
            workspace_id="ws-1",
            plan="solo",
            amount_minor=2900,
            currency="USD",
            status="pending",
            tax_mode="npd",
            fiscal_status="receipt_not_required",
            buyer_email="owner@example.com",
            buyer_snapshot_verified=True,
        )
        db.add_all([workspace, payment])
        await db.commit()

        assert await cloudpayments_service.process_pay(body, headers, db) == {"code": 0}
        await db.refresh(workspace)
        first_period_end = workspace.current_period_end
        assert workspace.subscription_tier == "solo"
        assert payment.status == "succeeded"

        assert await cloudpayments_service.process_pay(body, headers, db) == {"code": 0}
        await db.refresh(workspace)
        assert workspace.current_period_end == first_period_end

    await engine.dispose()
