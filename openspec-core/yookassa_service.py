import os
import uuid
import logging
import httpx
from typing import Dict, Any, Optional
from decimal import Decimal, ROUND_HALF_UP
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from datetime import datetime, timezone, timedelta
import models
import pricing

logger = logging.getLogger("vibus.billing.yookassa")

YOOKASSA_SHOP_ID = os.getenv("YOOKASSA_SHOP_ID", "")
YOOKASSA_SECRET_KEY = os.getenv("YOOKASSA_SECRET_KEY", "")
YOOKASSA_API_URL = "https://api.yookassa.ru/v3/payments"
YOOKASSA_REFUNDS_API_URL = "https://api.yookassa.ru/v3/refunds"
from settings import get_settings

def _allow_mock_billing() -> bool:
    try:
        return bool(get_settings().enable_mock_billing)
    except Exception:
        return False

# Backward-compatible test override; production still defaults to settings.
ALLOW_MOCK_BILLING = _allow_mock_billing()

def _fiscal_settings() -> tuple[str, str]:
    settings = get_settings()
    if settings.billing_tax_mode != "kkt_54fz":
        return "", ""
    vat_code = settings.yookassa_vat_code or os.getenv("YOOKASSA_VAT_CODE", "")
    payment_subject = settings.yookassa_payment_subject or os.getenv("YOOKASSA_PAYMENT_SUBJECT", "")
    if settings.environment in {"staging", "production", "quality_gate"} and (not vat_code or not payment_subject):
        raise HTTPException(status_code=503, detail="YooKassa 54-FZ fiscal settings are incomplete")
    return vat_code or "1", payment_subject or "service"

def to_minor_units(val: str | int | Decimal) -> int:
    if isinstance(val, int):
        return val
    d = Decimal(str(val))
    return int((d * Decimal(100)).quantize(Decimal(1), rounding=ROUND_HALF_UP))

def normalize_paid_tier(tier: str) -> str:
    normalized = str(getattr(tier, "value", tier)).lower().strip()
    aliases = {"pro": "solo", "team": "studio"}
    normalized = aliases.get(normalized, normalized)
    if normalized not in {"solo", "studio"}:
        raise HTTPException(status_code=422, detail="Unsupported paid tier")
    return normalized

async def create_yookassa_payment(
    workspace_id: str,
    owner_email: str,
    tier: str = "solo",
    return_url: str = "http://localhost:8000/billing/success",
    is_b2b: bool = False,
    company_inn: Optional[str] = None,
    company_name: Optional[str] = None,
    db: Optional[AsyncSession] = None,
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    settings = get_settings()
    tax_mode = settings.billing_tax_mode
    tier_lower = normalize_paid_tier(tier)
    amount_value = pricing.public_catalog()["markets"]["ru"]["plans"][tier_lower]["amount"]
    amount_minor = pricing.amount_minor("ru", tier_lower)
    tier_label = f"Solo ({settings.billing_period_days} дней)" if tier_lower in ("solo", "pro") else f"Studio ({settings.billing_period_days} дней)"

    if not idempotency_key:
        idempotency_key = str(uuid.uuid4())

    if not YOOKASSA_SHOP_ID or not YOOKASSA_SECRET_KEY:
        if not ALLOW_MOCK_BILLING:
            raise HTTPException(status_code=503, detail="YooKassa billing is not configured in this environment")
        logger.warning("YOOKASSA_SHOP_ID / SECRET_KEY не заданы. Возвращен тестовый mock URL.")
        mock_id = f"mock_yk_{idempotency_key}" if idempotency_key else f"mock_yk_{uuid.uuid4().hex[:12]}"
        if db:
            if hasattr(db, "execute"):
                existing_mock = (await db.execute(
                    select(models.Payment).where(models.Payment.provider_payment_id == mock_id)
                )).scalar_one_or_none()
                if existing_mock:
                    return {
                        "payment_id": existing_mock.provider_payment_id,
                        "confirmation_url": f"{return_url}?payment_id={mock_id}&mock=true&tier={tier_lower}",
                        "amount": amount_value,
                        "currency": "RUB",
                        "status": existing_mock.status,
                        "is_mock": True
                    }
            try:
                payment_record = models.Payment(
                    provider="yookassa",
                    provider_payment_id=mock_id,
                    workspace_id=workspace_id,
                    plan=tier_lower,
                    amount_minor=amount_minor,
                    currency="RUB",
                    status="pending",
                    tax_mode=tax_mode,
                    fiscal_status="receipt_not_required",
                    buyer_email=owner_email,
                    buyer_is_b2b=bool(is_b2b),
                    buyer_inn=company_inn if is_b2b else None,
                    buyer_name=company_name if is_b2b else None,
                    buyer_snapshot_verified=True,
                    is_test=True
                )
                db.add(payment_record)
                await db.commit()
            except Exception as e:
                logger.error(f"Failed to persist mock payment ledger record: {e}")
                await db.rollback()
                raise HTTPException(status_code=500, detail="Failed to record mock payment in ledger") from e
        return {
            "payment_id": mock_id,
            "confirmation_url": f"{return_url}?payment_id={mock_id}&mock=true&tier={tier_lower}",
            "amount": amount_value,
            "currency": "RUB",
            "is_mock": True
        }

    customer_data = {"email": owner_email}
    if is_b2b and company_inn:
        customer_data = {
            "full_name": company_name or "Организация",
            "inn": company_inn,
            "email": owner_email
        }
    
    payload = {
        "amount": {
            "value": amount_value,
            "currency": "RUB"
        },
        "capture": True,
        "confirmation": {
            "type": "redirect",
            "return_url": return_url
        },
        "description": f"Подписка Vibus {tier_label} (аккаунт: {owner_email})",
        "metadata": {
            "workspace_id": workspace_id,
            "user_email": owner_email,
            "tier": tier_lower,
            "tax_mode": tax_mode,
            "is_b2b": str(is_b2b).lower()
        }
    }

    if tax_mode == "kkt_54fz":
        vat_code, payment_subject = _fiscal_settings()
        payload["receipt"] = {
            "customer": customer_data,
            "items": [
                {
                    "description": f"Подписка Vibus {tier_label}",
                    "quantity": "1.00",
                    "amount": {
                        "value": amount_value,
                        "currency": "RUB"
                    },
                    "vat_code": vat_code,
                    "payment_mode": "full_payment",
                    "payment_subject": payment_subject
                }
            ]
        }
    
    if is_b2b:
        payload["payment_method_data"] = {
            "type": "b2b_sberbank",
            "payment_purpose": f"Оплата лицензии Vibus ({tier_label})"
        }

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                YOOKASSA_API_URL,
                json=payload,
                auth=(YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY),
                headers={
                    "Idempotence-Key": idempotency_key,
                    "Content-Type": "application/json"
                },
                timeout=15.0
            )

        if resp.status_code not in (200, 201):
            logger.error(f"ЮKassa API error [{resp.status_code}]: {resp.text}")
            raise HTTPException(status_code=502, detail="Ошибка создания платежа в ЮKassa")

        data = resp.json()
        provider_payment_id = (data.get("id") or "").strip()
        confirmation = data.get("confirmation") or {}
        confirmation_url = (confirmation.get("confirmation_url") or "").strip()

        if not provider_payment_id:
            logger.error("YooKassa checkout response missing payment ID: %s", data)
            raise HTTPException(status_code=502, detail="Invalid provider checkout response: missing payment ID")

        if not confirmation_url or not confirmation_url.startswith("https://"):
            logger.error("YooKassa checkout response missing valid HTTPS confirmation_url: %s", data)
            raise HTTPException(status_code=502, detail="Invalid provider checkout response: missing HTTPS confirmation URL")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to communicate with ЮKassa: {e}")
        raise HTTPException(status_code=502, detail="Не удалось связаться с ЮKassa")

    if db:
        if hasattr(db, "execute"):
            existing_payment = (await db.execute(
                select(models.Payment).where(models.Payment.provider_payment_id == provider_payment_id)
            )).scalar_one_or_none()
            if existing_payment:
                return {
                    "payment_id": existing_payment.provider_payment_id,
                    "confirmation_url": confirmation_url,
                    "amount": amount_value,
                    "currency": "RUB",
                    "status": existing_payment.status,
                    "is_mock": False
                }

        try:
            payment_record = models.Payment(
                provider="yookassa",
                provider_payment_id=provider_payment_id,
                workspace_id=workspace_id,
                plan=tier_lower,
                amount_minor=amount_minor,
                currency="RUB",
                status="pending",
                tax_mode=tax_mode,
                fiscal_status="receipt_not_required",
                buyer_email=owner_email,
                buyer_is_b2b=bool(is_b2b),
                buyer_inn=company_inn if is_b2b else None,
                buyer_name=company_name if is_b2b else None,
                buyer_snapshot_verified=True,
                is_test=False
            )
            db.add(payment_record)
            await db.commit()
        except Exception as e:
            logger.error(f"Failed to persist payment ledger record: {e}")
            await db.rollback()
            raise HTTPException(status_code=500, detail="Failed to record payment in ledger") from e

    return {
        "payment_id": provider_payment_id,
        "confirmation_url": confirmation_url,
        "amount": amount_value,
        "currency": "RUB",
        "status": data.get("status", "pending"),
        "is_mock": False
    }

async def process_yookassa_webhook(
    payload: Dict[str, Any],
    db: AsyncSession
) -> Dict[str, Any]:
    event = payload.get("event", "")
    event_obj = payload.get("object", {})

    logger.info(f"Получен вебхук ЮKassa: event={event}, id={event_obj.get('id')}")

    # Handle refund.succeeded event
    if event == "refund.succeeded":
        refund_id = event_obj.get("id")
        provider_payment_id = event_obj.get("payment_id")
        if not refund_id or not provider_payment_id:
            raise HTTPException(status_code=400, detail="Missing refund ID or payment_id in refund webhook object")

        if YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY and not str(refund_id).startswith("mock_") and not _allow_mock_billing():
            try:
                async with httpx.AsyncClient() as client:
                    verify_resp = await client.get(
                        f"{YOOKASSA_REFUNDS_API_URL}/{refund_id}",
                        auth=(YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY),
                        timeout=10.0
                    )
                if verify_resp.status_code == 200:
                    event_obj = verify_resp.json()
                else:
                    logger.error(f"YooKassa refund verification failed: [{verify_resp.status_code}] {verify_resp.text}")
                    raise HTTPException(status_code=409, detail="YooKassa refund verification failed")
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Failed to verify YooKassa refund: {e}")
                raise HTTPException(status_code=503, detail="YooKassa verification unreachable")

        if event_obj.get("status") != "succeeded":
            logger.warning(
                "Rejected unverified or non-succeeded refund %s (status: %s)",
                refund_id, event_obj.get("status")
            )
            return {"status": "ignored", "reason": "refund_not_succeeded"}

        # Find existing payment
        res_pay = await db.execute(
            select(models.Payment)
            .where(models.Payment.provider_payment_id == provider_payment_id)
            .with_for_update()
        )
        existing_payment = res_pay.scalar_one_or_none()
        if not existing_payment:
            logger.error("Refund received for unknown payment: %s", provider_payment_id)
            raise HTTPException(status_code=404, detail="Payment not found for refund")

        # Check idempotent duplicate refund
        res_ref = await db.execute(
            select(models.PaymentRefund).where(models.PaymentRefund.provider_refund_id == refund_id)
        )
        existing_refund = res_ref.scalar_one_or_none()
        if existing_refund:
            logger.info("Refund %s already recorded in ledger", refund_id)
            return {"status": "ok", "already_processed": True}

        amount_data = event_obj.get("amount") or {}
        value_str = amount_data.get("value", "0.00")
        currency = (amount_data.get("currency") or "RUB").upper()
        refund_amount_minor = to_minor_units(value_str)

        new_refund = models.PaymentRefund(
            provider_refund_id=refund_id,
            payment_id=existing_payment.id,
            amount_minor=refund_amount_minor,
            currency=currency,
            status="succeeded",
            description=event_obj.get("description"),
        )
        db.add(new_refund)

        # Check cumulative refunds
        prior_refunded = (await db.execute(
            select(func.coalesce(func.sum(models.PaymentRefund.amount_minor), 0))
            .where(models.PaymentRefund.payment_id == existing_payment.id)
        )).scalar_one()
        total_refunded = prior_refunded + refund_amount_minor

        if total_refunded >= existing_payment.amount_minor:
            existing_payment.status = "refunded"

        if existing_payment.tax_mode == "npd" and existing_payment.fiscal_status in {"receipt_required", "receipt_issued"}:
            existing_payment.fiscal_status = "receipt_refund_required"

        await db.commit()
        logger.info(
            "Recorded refund %s (%s minor) for payment %s; new status=%s, fiscal_status=%s",
            refund_id, refund_amount_minor, existing_payment.id, existing_payment.status, existing_payment.fiscal_status
        )
        return {"status": "ok", "event": event}

    payment_obj = event_obj
    payment_id = payment_obj.get("id")
    
    if not payment_id:
        raise HTTPException(status_code=400, detail="Missing payment ID in webhook object")

    if YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY and not str(payment_id).startswith("mock_") and not _allow_mock_billing():
        try:
            async with httpx.AsyncClient() as client:
                verify_resp = await client.get(
                    f"{YOOKASSA_API_URL}/{payment_id}",
                    auth=(YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY),
                    timeout=10.0
                )
            if verify_resp.status_code == 200:
                payment_obj = verify_resp.json()
            else:
                logger.error(f"YooKassa GET verification failed: [{verify_resp.status_code}] {verify_resp.text}")
                raise HTTPException(status_code=409, detail="YooKassa payment verification failed")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to verify YooKassa payment: {e}")
            raise HTTPException(status_code=503, detail="YooKassa verification unreachable")

    # Resolve pre-existing payment intent from ledger
    res_pay = await db.execute(
        select(models.Payment)
        .where(models.Payment.provider_payment_id == payment_id)
        .with_for_update()
    )
    existing_payment = res_pay.scalar_one_or_none()
    if not existing_payment:
        logger.warning(f"Unknown payment {payment_id} cannot create entitlement")
        return {"status": "ignored", "reason": "unknown_payment"}

    if existing_payment.status == "succeeded":
        logger.info(f"Payment {payment_id} already processed. Idempotent return.")
        return {"status": "ok", "duplicate": True}

    if event == "payment.succeeded" and payment_obj.get("status") == "succeeded":
        is_test = payment_obj.get("test", False)
        if is_test and not _allow_mock_billing():
            logger.error(f"Rejected TEST payment {payment_id} in production environment!")
            raise HTTPException(status_code=400, detail="Test payments are not allowed in production")

        paid_amount_str = payment_obj.get("amount", {}).get("value", "0")
        paid_minor = to_minor_units(paid_amount_str)
        paid_currency = (payment_obj.get("amount", {}).get("currency") or "RUB").upper()

        if paid_minor != existing_payment.amount_minor:
            logger.error(f"Payment amount mismatch for {payment_id}. Expected {existing_payment.amount_minor}, got {paid_minor}")
            return {"status": "ignored", "reason": "amount_mismatch"}

        if paid_currency != existing_payment.currency:
            logger.error(f"Payment currency mismatch for {payment_id}. Expected {existing_payment.currency}, got {paid_currency}")
            return {"status": "ignored", "reason": "currency_mismatch"}

        now = models.utcnow()
        existing_payment.status = "succeeded"
        existing_payment.processed_at = now
        if existing_payment.tax_mode == "npd":
            existing_payment.fiscal_status = "receipt_required"
        else:
            existing_payment.fiscal_status = "receipt_not_required"

        res_ws = await db.execute(
            select(models.Workspace)
            .where(models.Workspace.id == existing_payment.workspace_id)
            .with_for_update()
        )
        ws = res_ws.scalar_one_or_none()
        pm_obj = payment_obj.get("payment_method", {})
        if ws:
            if not existing_payment.buyer_email and ws.owner_email:
                existing_payment.buyer_email = ws.owner_email
                existing_payment.buyer_snapshot_verified = True

            # Manual 30-day entitlement. A new successful payment extends from
            # the later of now/current_period_end, so early renewal never loses days.
            current_end = ws.current_period_end
            was_active = (
                (ws.subscription_status or "inactive") == "active"
                and current_end is not None
                and current_end > now
            )
            grant_start = current_end if was_active else now
            workspace_period_start = ws.current_period_start if was_active and ws.current_period_start else now
            period_end = grant_start + timedelta(days=get_settings().billing_period_days)

            existing_payment.entitlement_period_start = grant_start
            existing_payment.entitlement_period_end = period_end
            ws.subscription_tier = existing_payment.plan
            ws.subscription_status = "active"
            ws.current_period_start = workspace_period_start
            ws.current_period_end = period_end
            ws.cancel_at_period_end = False
            ws.billing_provider = "yookassa"

            # Store a reusable method only when provider confirms it is saved and
            # the user has not previously refused reuse. This RC still uses manual
            # renewal; no background recurring charge is scheduled.
            if (
                pm_obj.get("saved") is True
                and pm_obj.get("id")
                and not getattr(ws, "payment_method_refused", False)
            ):
                ws.yookassa_payment_method_id = pm_obj.get("id")
            await db.commit()
            logger.info(
                "Workspace %s granted %s until %s from YooKassa payment %s",
                ws.id, existing_payment.plan, period_end.isoformat(), payment_id
            )
        else:
            await db.commit()

    elif event == "payment.canceled":
        if payment_obj.get("status") != "canceled":
            logger.warning(
                f"YooKassa event payment.canceled received, but payment {payment_id} status is {payment_obj.get('status')}. Ignored."
            )
            return {"status": "ignored", "reason": "status_not_canceled"}
        existing_payment.status = "canceled"
        await db.commit()
        logger.warning(f"Платеж ЮKassa {payment_id} был отменен")

    return {"status": "ok", "event": event}

async def cancel_auto_payments(
    payment_method_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    db: Optional[AsyncSession] = None
) -> bool:
    """Refuse future reuse of a saved YooKassa payment method.

    VibeUs RC uses manual 30-day renewal, so there is no provider-side
    subscription to cancel. The legal/technical guarantee is local: once the
    user refuses reuse, future payment creation must not use the stored method.
    """
    if workspace_id and db:
        res = await db.execute(
            select(models.Workspace)
            .where(models.Workspace.id == workspace_id)
            .with_for_update()
        )
        ws = res.scalar_one_or_none()
        if ws:
            ws.payment_method_refused = True
            ws.payment_method_refused_at = models.utcnow()
            ws.yookassa_payment_method_id = None
            ws.cancel_at_period_end = True
            await db.commit()

    logger.info(
        "YooKassa payment-method reuse refused for workspace=%s, pm=%s",
        workspace_id, payment_method_id
    )
    return True
