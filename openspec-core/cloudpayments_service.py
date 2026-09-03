from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP
from urllib.parse import parse_qs, unquote_plus

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import models
import pricing
from settings import get_settings


def _minor_to_decimal(value: int) -> Decimal:
    return (Decimal(value) / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _signature(payload: bytes, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def _header_value(headers, name: str) -> str:
    """Read an HTTP header from Starlette Headers or a plain mapping.

    ASGI header collections are case-insensitive, but unit tests and provider
    adapters can pass ordinary dicts. Treat header names according to HTTP
    semantics instead of relying on the container implementation.
    """
    if headers is None:
        return ""
    if hasattr(headers, "get"):
        value = headers.get(name)
        if value:
            return str(value).strip()
    items = headers.items() if hasattr(headers, "items") else ()
    lowered = name.lower()
    for key, value in items:
        if str(key).lower() == lowered:
            return str(value or "").strip()
    return ""


def verify_notification_hmac(raw_body: bytes, headers) -> bool:
    """Verify CloudPayments POST notification integrity.

    CloudPayments sends X-Content-HMAC for URL-decoded content and Content-HMAC
    for URL-encoded content. We accept either valid representation and compare
    in constant time.
    """
    secret = get_settings().cloudpayments_api_secret.get_secret_value()
    if not secret:
        return False
    encoded_header = _header_value(headers, "content-hmac")
    decoded_header = _header_value(headers, "x-content-hmac")
    if encoded_header and hmac.compare_digest(_signature(raw_body, secret), encoded_header):
        return True
    if decoded_header:
        try:
            decoded = unquote_plus(raw_body.decode("utf-8")).encode("utf-8")
        except UnicodeDecodeError:
            decoded = raw_body
        if hmac.compare_digest(_signature(decoded, secret), decoded_header):
            return True
    return False


def parse_notification(raw_body: bytes) -> dict[str, str]:
    parsed = parse_qs(raw_body.decode("utf-8"), keep_blank_values=True)
    return {key: values[-1] if values else "" for key, values in parsed.items()}


def _amount_minor(raw: str) -> int:
    try:
        return int((Decimal(str(raw)) * Decimal(100)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid CloudPayments amount") from exc


async def create_order(
    *,
    db: AsyncSession,
    workspace: models.Workspace,
    tier: str,
    success_url: str,
    fail_url: str,
    culture: str = "en-US",
) -> dict:
    cfg = get_settings()
    if not cfg.enable_cloudpayments and not cfg.enable_mock_billing:
        raise HTTPException(status_code=503, detail="CloudPayments billing is disabled")

    normalized_tier = pricing.normalize_tier(tier)
    amount_minor = pricing.amount_minor("global", normalized_tier)
    currency = cfg.cloudpayments_global_currency
    if currency != "USD":
        # The current public global catalog is denominated in USD. Do not
        # silently charge the USD numeric amount in another currency.
        raise HTTPException(status_code=503, detail="Global pricing currency/provider configuration mismatch")

    invoice_id = f"vbcp_{uuid.uuid4().hex}"
    payment = models.Payment(
        provider="cloudpayments",
        provider_payment_id=invoice_id,
        workspace_id=workspace.id,
        plan=normalized_tier,
        amount_minor=amount_minor,
        currency=currency,
        status="pending",
        is_test=bool(cfg.enable_mock_billing),
        tax_mode=cfg.billing_tax_mode,
        fiscal_status="receipt_not_required",
        buyer_email=workspace.owner_email,
        buyer_is_b2b=False,
        buyer_snapshot_verified=bool(workspace.owner_email),
    )
    db.add(payment)
    db.add(models.AuditEvent(
        workspace_id=workspace.id,
        event_type="billing.checkout.created",
        details={"provider": "cloudpayments", "invoice_id": invoice_id, "tier": normalized_tier, "amount_minor": amount_minor, "currency": currency},
    ))
    # Commit before calling the provider: a fast webhook can never arrive before
    # the authoritative local invoice exists.
    await db.commit()
    await db.refresh(payment)

    if cfg.enable_mock_billing and not cfg.enable_cloudpayments:
        return {
            "provider": "cloudpayments",
            "payment_id": payment.id,
            "invoice_id": invoice_id,
            "checkout_url": f"{success_url}{'&' if '?' in success_url else '?'}mock_invoice={invoice_id}",
        }

    payload = {
        "Amount": float(_minor_to_decimal(amount_minor)),
        "Currency": currency,
        "Description": f"VibeUs {normalized_tier.title()} access for {cfg.billing_period_days} days",
        "Email": workspace.owner_email,
        "AccountId": workspace.id,
        "InvoiceId": invoice_id,
        "RequireConfirmation": False,
        "SendEmail": False,
        "SendSms": False,
        "SendViber": False,
        "CultureName": culture if culture in {"ru-RU", "en-US"} else "en-US",
        "SuccessRedirectUrl": success_url,
        "FailRedirectUrl": fail_url,
        "JsonData": json.dumps({"cloudpayments": {"vibeus_payment_id": payment.id, "workspace_id": workspace.id, "tier": normalized_tier}}, ensure_ascii=False),
    }
    auth = httpx.BasicAuth(
        cfg.cloudpayments_public_id.get_secret_value(),
        cfg.cloudpayments_api_secret.get_secret_value(),
    )
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{str(cfg.cloudpayments_api_base_url).rstrip('/')}/orders/create",
                json=payload,
                auth=auth,
            )
        data = response.json()
        checkout_url = ((data.get("Model") or {}).get("Url") if isinstance(data, dict) else None)
        if response.status_code >= 400 or not isinstance(data, dict) or not data.get("Success") or not checkout_url:
            raise RuntimeError(str(data.get("Message") if isinstance(data, dict) else response.text)[:500])
    except Exception as exc:
        payment.status = "canceled"
        payment.processed_at = models.utcnow()
        db.add(models.AuditEvent(
            workspace_id=workspace.id,
            event_type="billing.checkout.provider_failed",
            details={"provider": "cloudpayments", "invoice_id": invoice_id, "error": str(exc)[:300]},
        ))
        await db.commit()
        raise HTTPException(status_code=502, detail="CloudPayments failed to create checkout") from exc

    return {
        "provider": "cloudpayments",
        "payment_id": payment.id,
        "invoice_id": invoice_id,
        "checkout_url": checkout_url,
    }


async def _locked_payment(db: AsyncSession, invoice_id: str) -> models.Payment | None:
    result = await db.execute(
        select(models.Payment)
        .where(
            models.Payment.provider == "cloudpayments",
            models.Payment.provider_payment_id == invoice_id,
        )
        .with_for_update()
    )
    return result.scalar_one_or_none()


def _check_notification_against_payment(payment: models.Payment, data: dict[str, str]) -> int:
    if data.get("AccountId") and data.get("AccountId") != payment.workspace_id:
        return 11
    if _amount_minor(data.get("Amount", "0")) != payment.amount_minor:
        return 12
    if data.get("Currency") and data.get("Currency") != payment.currency:
        return 12
    return 0


async def process_check(raw_body: bytes, headers, db: AsyncSession) -> dict:
    if not verify_notification_hmac(raw_body, headers):
        raise HTTPException(status_code=403, detail="Invalid CloudPayments HMAC")
    data = parse_notification(raw_body)
    invoice_id = data.get("InvoiceId", "")
    payment = await _locked_payment(db, invoice_id)
    if not payment:
        return {"code": 10}
    return {"code": _check_notification_against_payment(payment, data)}


async def process_pay(raw_body: bytes, headers, db: AsyncSession) -> dict:
    if not verify_notification_hmac(raw_body, headers):
        raise HTTPException(status_code=403, detail="Invalid CloudPayments HMAC")
    data = parse_notification(raw_body)
    invoice_id = data.get("InvoiceId", "")
    payment = await _locked_payment(db, invoice_id)
    if not payment:
        raise HTTPException(status_code=409, detail="Unknown CloudPayments invoice")
    check_code = _check_notification_against_payment(payment, data)
    if check_code != 0:
        db.add(models.AuditEvent(
            workspace_id=payment.workspace_id,
            event_type="billing.webhook.mismatch",
            details={"provider": "cloudpayments", "invoice_id": invoice_id, "code": check_code},
        ))
        await db.commit()
        raise HTTPException(status_code=409, detail=f"CloudPayments payment mismatch ({check_code})")

    # Provider retries are expected. A succeeded invoice is an idempotent no-op,
    # never a second entitlement extension.
    if payment.status == "succeeded":
        return {"code": 0}
    if payment.status not in {"pending", "canceled"}:
        raise HTTPException(status_code=409, detail="Payment is not eligible for settlement")

    workspace_result = await db.execute(
        select(models.Workspace)
        .where(models.Workspace.id == payment.workspace_id)
        .with_for_update()
    )
    workspace = workspace_result.scalar_one_or_none()
    if not workspace:
        raise HTTPException(status_code=409, detail="Payment workspace no longer exists")

    now = models.utcnow()
    period_days = get_settings().billing_period_days
    base = workspace.current_period_end if workspace.current_period_end and workspace.current_period_end > now else now
    payment.status = "succeeded"
    payment.processed_at = now
    payment.entitlement_period_start = base
    payment.entitlement_period_end = base + timedelta(days=period_days)
    if payment.tax_mode == "npd":
        payment.fiscal_status = "receipt_required"

    workspace.subscription_tier = payment.plan
    workspace.subscription_status = "active"
    workspace.current_period_start = workspace.current_period_start or now
    workspace.current_period_end = payment.entitlement_period_end
    workspace.cancel_at_period_end = False
    workspace.billing_provider = "cloudpayments"
    workspace.is_lifetime_free = False

    transaction_id = data.get("TransactionId") or ""
    db.add(models.AuditEvent(
        workspace_id=workspace.id,
        event_type="billing.payment.succeeded",
        details={"provider": "cloudpayments", "invoice_id": invoice_id, "transaction_id": transaction_id, "payment_id": payment.id},
    ))
    await db.commit()
    return {"code": 0}


async def process_fail(raw_body: bytes, headers, db: AsyncSession) -> dict:
    if not verify_notification_hmac(raw_body, headers):
        raise HTTPException(status_code=403, detail="Invalid CloudPayments HMAC")
    data = parse_notification(raw_body)
    payment = await _locked_payment(db, data.get("InvoiceId", ""))
    if not payment:
        return {"code": 0}
    if payment.status == "pending":
        payment.status = "canceled"
        payment.processed_at = models.utcnow()
        await db.commit()
    return {"code": 0}


async def process_refund(raw_body: bytes, headers, db: AsyncSession) -> dict:
    if not verify_notification_hmac(raw_body, headers):
        raise HTTPException(status_code=403, detail="Invalid CloudPayments HMAC")
    data = parse_notification(raw_body)
    payment = await _locked_payment(db, data.get("InvoiceId", ""))
    if not payment:
        return {"code": 0}

    amount_minor = _amount_minor(data.get("Amount", "0"))
    provider_refund_id = f"cp_refund_{data.get('TransactionId') or uuid.uuid4().hex}"
    existing = await db.execute(
        select(models.PaymentRefund).where(models.PaymentRefund.provider_refund_id == provider_refund_id)
    )
    if not existing.scalar_one_or_none():
        db.add(models.PaymentRefund(
            provider_refund_id=provider_refund_id,
            payment_id=payment.id,
            amount_minor=amount_minor,
            currency=payment.currency,
            status="succeeded",
            description="CloudPayments refund notification",
        ))
    if amount_minor >= payment.amount_minor:
        payment.status = "refunded"
    if payment.tax_mode == "npd":
        payment.fiscal_status = "receipt_refund_required"
    db.add(models.AuditEvent(
        workspace_id=payment.workspace_id,
        event_type="billing.payment.refunded",
        details={"provider": "cloudpayments", "payment_id": payment.id, "amount_minor": amount_minor},
    ))
    await db.commit()
    return {"code": 0}
