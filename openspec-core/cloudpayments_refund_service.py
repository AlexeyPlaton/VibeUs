from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import cloudpayments_service
import models


async def process_refund(raw_body: bytes, headers, db: AsyncSession) -> dict:
    if not cloudpayments_service.verify_notification_hmac(raw_body, headers):
        raise HTTPException(status_code=403, detail="Invalid CloudPayments HMAC")

    data = cloudpayments_service.parse_notification(raw_body)
    invoice_id = data.get("InvoiceId", "")
    payment = await cloudpayments_service._locked_payment(db, invoice_id)
    if not payment:
        return {"code": 0}

    amount_minor = cloudpayments_service._amount_minor(data.get("Amount", "0"))
    if amount_minor <= 0 or amount_minor > payment.amount_minor:
        raise HTTPException(status_code=409, detail="Invalid CloudPayments refund amount")

    transaction_id = data.get("TransactionId") or ""
    provider_refund_id = f"cp_refund_{transaction_id or uuid.uuid4().hex}"
    existing = await db.execute(
        select(models.PaymentRefund).where(
            models.PaymentRefund.provider_refund_id == provider_refund_id
        )
    )
    if existing.scalar_one_or_none():
        return {"code": 0}

    refund = models.PaymentRefund(
        provider_refund_id=provider_refund_id,
        payment_id=payment.id,
        amount_minor=amount_minor,
        currency=payment.currency,
        status="succeeded",
        description="CloudPayments refund notification",
    )
    db.add(refund)
    await db.flush()

    refunded_total = (await db.execute(
        select(func.coalesce(func.sum(models.PaymentRefund.amount_minor), 0)).where(
            models.PaymentRefund.payment_id == payment.id,
            models.PaymentRefund.status == "succeeded",
        )
    )).scalar() or 0

    fully_refunded = int(refunded_total) >= int(payment.amount_minor)
    if fully_refunded:
        payment.status = "refunded"

        # Revoke only the entitlement edge produced by this exact payment. If a
        # later payment already extended the workspace, leave that later period
        # intact. This makes out-of-order refund notifications safe.
        workspace_result = await db.execute(
            select(models.Workspace)
            .where(models.Workspace.id == payment.workspace_id)
            .with_for_update()
        )
        workspace = workspace_result.scalar_one_or_none()
        if (
            workspace
            and payment.entitlement_period_end
            and workspace.current_period_end == payment.entitlement_period_end
        ):
            workspace.current_period_end = payment.entitlement_period_start
            now = models.utcnow()
            if not workspace.current_period_end or workspace.current_period_end <= now:
                workspace.subscription_status = "canceled"
                workspace.cancel_at_period_end = False

    if payment.tax_mode == "npd":
        payment.fiscal_status = "receipt_refund_required"

    db.add(models.AuditEvent(
        workspace_id=payment.workspace_id,
        event_type="billing.payment.refunded",
        details={
            "provider": "cloudpayments",
            "payment_id": payment.id,
            "invoice_id": invoice_id,
            "refund_id": provider_refund_id,
            "amount_minor": amount_minor,
            "refunded_total_minor": int(refunded_total),
            "fully_refunded": fully_refunded,
        },
    ))
    await db.commit()
    return {"code": 0}
