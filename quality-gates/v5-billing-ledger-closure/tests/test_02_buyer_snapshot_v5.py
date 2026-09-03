from __future__ import annotations

from types import SimpleNamespace

import pytest
from pydantic import ValidationError


@pytest.mark.blocker
@pytest.mark.fiscal
def test_b2b_request_requires_inn_and_company_name(service_modules):
    Schema = service_modules.schemas.CreateYookassaPaymentRequest

    for payload in (
        {"workspace_id": "ws", "is_b2b": True},
        {"workspace_id": "ws", "is_b2b": True, "company_inn": "7701234567"},
        {"workspace_id": "ws", "is_b2b": True, "company_inn": "   ", "company_name": "ООО Test"},
        {"workspace_id": "ws", "is_b2b": True, "company_inn": "7701234567", "company_name": "   "},
    ):
        with pytest.raises(ValidationError):
            Schema(**payload)

    valid = Schema(
        workspace_id="ws",
        is_b2b=True,
        company_inn="7701234567",
        company_name='ООО "Покупатель"',
    )
    assert valid.is_b2b is True


@pytest.mark.blocker
@pytest.mark.fiscal
def test_payment_has_explicit_buyer_snapshot_verification_state(service_modules):
    Payment = service_modules.models.Payment
    cols = {c.name for c in Payment.__table__.columns}
    assert "buyer_snapshot_verified" in cols, (
        "Legacy rows and checkout-time snapshots must be distinguishable; add Payment.buyer_snapshot_verified."
    )


class ScalarResult:
    def __init__(self, obj):
        self.obj = obj

    def scalar_one_or_none(self):
        return self.obj


class ReceiptDB:
    def __init__(self, payment):
        self.payment = payment
        self.added = []
        self.commit_calls = 0

    async def execute(self, _stmt):
        return ScalarResult(self.payment)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commit_calls += 1

    async def refresh(self, _obj):
        return None


@pytest.mark.blocker
@pytest.mark.fiscal
@pytest.mark.asyncio
async def test_unverified_legacy_buyer_snapshot_cannot_be_marked_receipt_issued(receipt_module):
    payment = SimpleNamespace(
        id="pay-v5-legacy",
        provider_payment_id="yk-v5-legacy",
        workspace_id="ws-v5-legacy",
        status="succeeded",
        tax_mode="npd",
        fiscal_status="receipt_required",
        receipt_url=None,
        receipt_issued_at=None,
        buyer_email=None,
        buyer_is_b2b=False,
        buyer_inn=None,
        buyer_name=None,
        buyer_snapshot_verified=False,
    )
    db = ReceiptDB(payment)
    with pytest.raises(ValueError, match="(?i)(buyer|snapshot|reconcil|verify)"):
        await receipt_module.mark_receipt_issued(
            db,
            payment.id,
            "https://lknpd.nalog.ru/api/v1/receipt/example/print",
        )
    assert db.commit_calls == 0


@pytest.mark.blocker
@pytest.mark.fiscal
@pytest.mark.asyncio
async def test_operator_can_reconcile_legacy_buyer_snapshot_before_receipt(receipt_module):
    assert hasattr(receipt_module, "reconcile_buyer_snapshot"), (
        "Add operator-only reconcile_buyer_snapshot for legacy payments; do not guess mutable B2B history."
    )
    payment = SimpleNamespace(
        id="pay-v5-reconcile",
        provider_payment_id="yk-v5-reconcile",
        workspace_id="ws-v5-reconcile",
        status="succeeded",
        tax_mode="npd",
        fiscal_status="receipt_required",
        buyer_email=None,
        buyer_is_b2b=False,
        buyer_inn=None,
        buyer_name=None,
        buyer_snapshot_verified=False,
    )
    db = ReceiptDB(payment)
    result = await receipt_module.reconcile_buyer_snapshot(
        db,
        payment.id,
        buyer_email="buyer@example.test",
        buyer_is_b2b=True,
        buyer_inn="7701234567",
        buyer_name='ООО "Verified Buyer"',
    )
    assert result.buyer_snapshot_verified is True
    assert result.buyer_email == "buyer@example.test"
    assert result.buyer_is_b2b is True
    assert result.buyer_inn == "7701234567"
    assert "Verified Buyer" in result.buyer_name
    assert any(getattr(evt, "event_type", "") == "billing.npd_buyer_snapshot_reconciled" for evt in db.added)
    assert db.commit_calls == 1
