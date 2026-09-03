import os
import uuid
import logging
import json
from typing import Optional, Dict, Any
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

import models
import pricing

logger = logging.getLogger("vibus.billing.stripe")

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")

from settings import get_settings

try:
    ALLOW_MOCK_BILLING = get_settings().enable_mock_billing
except Exception:
    ALLOW_MOCK_BILLING = False

def get_stripe_client():
    try:
        import stripe
        if STRIPE_SECRET_KEY:
            stripe.api_key = STRIPE_SECRET_KEY
        return stripe
    except ImportError:
        return None

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

async def create_checkout_session(
    workspace_id: str,
    owner_email: str,
    tier: str = "solo",
    success_url: str = "http://localhost:8000/billing/success?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: str = "http://localhost:8000/billing/cancel",
    db: Optional[AsyncSession] = None
) -> Dict[str, Any]:
    tier = normalize_paid_tier(tier)
    stripe = get_stripe_client()
    if not stripe or not STRIPE_SECRET_KEY:
        if not ALLOW_MOCK_BILLING:
            raise HTTPException(status_code=503, detail="Stripe billing is not configured in this environment")
        logger.warning("STRIPE_SECRET_KEY not set. Returning mock checkout URL.")
        mock_sess_id = f"mock_sess_{uuid.uuid4().hex[:12]}"
        if db:
            amount_minor = pricing.amount_minor("global", tier)
            payment_record = models.Payment(
                provider="stripe",
                provider_payment_id=mock_sess_id,
                workspace_id=workspace_id,
                plan=str(tier).lower(),
                amount_minor=amount_minor,
                currency="USD",
                status="pending",
                is_test=True
            )
            db.add(payment_record)
            await db.commit()
        return {
            "checkout_url": f"{success_url.replace('{CHECKOUT_SESSION_ID}', mock_sess_id)}&mock=true&tier={tier}",
            "session_id": mock_sess_id,
            "is_mock": True
        }

    amount_minor = pricing.amount_minor("global", tier)

    try:
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            customer_email=owner_email,
            line_items=[
                {
                    "price_data": {
                        "currency": "usd",
                        "unit_amount": amount_minor,
                        "product_data": {
                            "name": f"VibeUs {tier.title()} - {get_settings().billing_period_days} days"
                        },
                    },
                    "quantity": 1,
                },
            ],
            mode="payment",
            success_url=success_url,
            cancel_url=cancel_url,
            client_reference_id=workspace_id,
            metadata={
                "workspace_id": workspace_id,
                "tier": tier
            }
        )
        if db:
            payment_record = models.Payment(
                provider="stripe",
                provider_payment_id=session.id,
                workspace_id=workspace_id,
                plan=tier.lower(),
                amount_minor=amount_minor,
                currency="USD",
                status="pending",
                is_test=False
            )
            db.add(payment_record)
            await db.commit()

        return {
            "checkout_url": session.url,
            "session_id": session.id,
            "is_mock": False
        }
    except Exception as e:
        logger.error(f"Stripe checkout creation failed: {e}")
        raise HTTPException(status_code=500, detail="Ошибка создания платежной сессии")

async def disable_recurring_payment(customer_id: str) -> Dict[str, Any]:
    stripe = get_stripe_client()
    if not stripe or not STRIPE_SECRET_KEY:
        raise RuntimeError("Stripe is not configured")
    try:
        subscriptions = stripe.Subscription.list(customer=customer_id, status="active")
        for sub in subscriptions.get("data", []):
            stripe.Subscription.delete(sub.id)
        return {"ok": True, "provider_status": "canceled"}
    except Exception as e:
        logger.error(f"Stripe cancellation error: {e}")
        raise

async def cancel_recurring_payment(customer_id: str) -> Dict[str, Any]:
    return await disable_recurring_payment(customer_id)

async def cancel_subscription_and_detach_payment_method(customer_id: str) -> Dict[str, Any]:
    return await disable_recurring_payment(customer_id)

async def process_webhook_event(
    payload: bytes,
    sig_header: str,
    db: AsyncSession
) -> Dict[str, Any]:
    stripe = get_stripe_client()
    if not STRIPE_WEBHOOK_SECRET or not stripe:
        if not ALLOW_MOCK_BILLING:
            raise HTTPException(status_code=503, detail="Stripe webhook signature verification unavailable")
        try:
            event = json.loads(payload.decode('utf-8'))
        except Exception:
            event = {}
    else:
        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, STRIPE_WEBHOOK_SECRET
            )
        except Exception as err:
            logger.error(f"Stripe webhook signature error: {err}")
            raise HTTPException(status_code=400, detail="Invalid signature")

    event_type = event.get("type", "") if isinstance(event, dict) else getattr(event, "type", "")
    data_object = event.get("data", {}).get("object", {}) if isinstance(event, dict) else event.data.object

    logger.info(f"Received Stripe webhook event: {event_type}")

    if event_type == "checkout.session.completed":
        session_id = data_object.get("id")
        amount_total = data_object.get("amount_total")
        currency = (data_object.get("currency") or "").upper()
        payment_status = data_object.get("payment_status")
        customer_id = data_object.get("customer")

        if not session_id:
            return {"status": "ignored", "reason": "no_session_id"}

        res_pay = await db.execute(
            select(models.Payment)
            .where(models.Payment.provider_payment_id == session_id)
            .with_for_update()
        )
        payment = res_pay.scalar_one_or_none()
        if not payment:
            return {"status": "ignored", "reason": "unknown_session"}

        if payment_status != "paid":
            return {"status": "ignored", "reason": "not_paid"}

        if amount_total is not None and payment.amount_minor != int(amount_total):
            return {"status": "ignored", "reason": "amount_mismatch"}

        if currency and payment.currency.upper() != currency:
            return {"status": "ignored", "reason": "currency_mismatch"}

        if payment.status == "succeeded":
            return {"status": "processed", "type": event_type, "duplicate": True}

        now = models.utcnow()
        payment.status = "succeeded"
        payment.processed_at = now

        res_ws = await db.execute(
            select(models.Workspace)
            .where(models.Workspace.id == payment.workspace_id)
            .with_for_update()
        )
        ws = res_ws.scalar_one_or_none()
        if ws:
            current_end = ws.current_period_end
            was_active = (
                (ws.subscription_status or "inactive") == "active"
                and current_end is not None
                and current_end > now
            )
            grant_start = current_end if was_active else now
            workspace_period_start = ws.current_period_start if was_active and ws.current_period_start else now
            period_end = grant_start + timedelta(days=get_settings().billing_period_days)
            payment.entitlement_period_start = grant_start
            payment.entitlement_period_end = period_end
            ws.subscription_tier = payment.plan
            ws.subscription_status = "active"
            ws.current_period_start = workspace_period_start
            ws.current_period_end = period_end
            ws.cancel_at_period_end = False
            ws.billing_provider = "stripe"
            ws.stripe_customer_id = customer_id
            await db.commit()
            logger.info(f"Workspace {ws.id} upgraded to {payment.plan} until {period_end.isoformat()} (Stripe Customer: {customer_id})")

    elif event_type in ["customer.subscription.deleted", "customer.subscription.paused"]:
        customer_id = data_object.get("customer")
        if customer_id:
            res = await db.execute(select(models.Workspace).where(models.Workspace.stripe_customer_id == customer_id))
            ws = res.scalar_one_or_none()
            if ws and not getattr(ws, 'is_lifetime_free', False):
                ws.subscription_status = "canceled"
                ws.current_period_end = min(ws.current_period_end, models.utcnow()) if ws.current_period_end else models.utcnow()
                await db.commit()

    return {"status": "processed", "type": event_type}
