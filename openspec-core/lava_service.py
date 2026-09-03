from __future__ import annotations

import hmac
import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Mapping, Optional

import httpx
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

import models
import pricing
from settings import get_settings

logger = logging.getLogger("vibus.billing.lava")


def normalize_paid_tier(tier: str) -> str:
    normalized = str(getattr(tier, "value", tier)).strip().lower()
    normalized = {"pro": "solo", "team": "studio", "enterprise": "studio"}.get(normalized, normalized)
    if normalized not in {"solo", "studio"}:
        raise HTTPException(status_code=422, detail="Unsupported paid tier")
    return normalized


def _amount_number(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def offer_id_for_tier(tier: str) -> str:
    cfg = get_settings()
    tier = normalize_paid_tier(tier)
    offer_id = cfg.lava_offer_id_solo if tier == "solo" else cfg.lava_offer_id_studio
    if not offer_id.strip():
        raise HTTPException(status_code=503, detail="LAVA offer is not configured")
    return offer_id.strip()


def build_invoice_payload(owner_email: str, tier: str) -> dict[str, Any]:
    """Build the documented LAVA v3 custom-price invoice request.

    VibeUs intentionally uses a one-time USD invoice. Entitlement renewal is
    handled by VibeUs after a verified payment webhook instead of pretending a
    recurring mandate exists when it does not.
    """
    tier = normalize_paid_tier(tier)
    return {
        "email": owner_email.strip().lower(),
        "offerId": offer_id_for_tier(tier),
        "currency": "USD",
        "amount": _amount_number(pricing.amount("global", tier)),
    }


def parse_invoice_response(data: Mapping[str, Any]) -> tuple[str, str]:
    """Extract stable invoice identity and hosted checkout URL fail-closed."""
    invoice_id = str(data.get("id") or data.get("invoiceId") or data.get("contractId") or "").strip()
    payment_url = str(data.get("paymentUrl") or data.get("payment_url") or "").strip()
    if not invoice_id or not payment_url or not payment_url.startswith("https://"):
        raise HTTPException(status_code=502, detail="LAVA returned an invalid invoice response")
    return invoice_id, payment_url


def verify_webhook_api_key(received: str | None) -> bool:
    expected = get_settings().lava_webhook_api_key.get_secret_value()
    if not expected or not received:
        return False
    return hmac.compare_digest(expected.encode("utf-8"), received.strip().encode("utf-8"))


def require_webhook_api_key(received: str | None) -> None:
    if not verify_webhook_api_key(received):
        raise HTTPException(status_code=401, detail="Invalid LAVA webhook API key")


async def create_invoice(
    workspace_id: str,
    owner_email: str,
    tier: str = "solo",
    db: Optional[AsyncSession] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> dict[str, Any]:
    cfg = get_settings()
    if not cfg.enable_lava:
        raise HTTPException(status_code=503, detail="LAVA billing is disabled")
    api_key = cfg.lava_api_key.get_secret_value()
    if not api_key:
        raise HTTPException(status_code=503, detail="LAVA billing is not configured")

    tier = normalize_paid_tier(tier)
    payload = build_invoice_payload(owner_email, tier)
    endpoint = str(cfg.lava_api_base_url).rstrip("/") + "/api/v3/invoice"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Api-Key": api_key,
    }

    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=20.0, follow_redirects=False)
    try:
        response = await http.post(endpoint, json=payload, headers=headers)
        if response.status_code >= 400:
            logger.error("LAVA invoice creation failed with HTTP %s", response.status_code)
            raise HTTPException(status_code=502, detail="International payment provider rejected checkout creation")
        try:
            body = response.json()
        except Exception as exc:
            raise HTTPException(status_code=502, detail="International payment provider returned invalid JSON") from exc
        if not isinstance(body, Mapping):
            raise HTTPException(status_code=502, detail="International payment provider returned invalid response")
        invoice_id, payment_url = parse_invoice_response(body)

        if db is not None:
            payment = models.Payment(
                provider="lava",
                provider_payment_id=invoice_id,
                workspace_id=workspace_id,
                plan=tier,
                amount_minor=pricing.amount_minor("global", tier),
                currency="USD",
                status="pending",
                is_test=False,
                tax_mode=cfg.billing_tax_mode,
                fiscal_status="receipt_not_required",
                buyer_email=owner_email.strip().lower(),
                buyer_is_b2b=False,
                buyer_snapshot_verified=True,
            )
            db.add(payment)
            await db.commit()

        return {
            "checkout_url": payment_url,
            "session_id": invoice_id,
            "provider": "lava",
            "is_mock": False,
        }
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        logger.error("LAVA network error: %s", exc)
        raise HTTPException(status_code=502, detail="International payment provider is unavailable") from exc
    finally:
        if owns_client:
            await http.aclose()


def webhook_event_type(payload: Mapping[str, Any]) -> str:
    return str(payload.get("eventType") or payload.get("event_type") or payload.get("type") or "").strip()


def webhook_invoice_id(payload: Mapping[str, Any]) -> str:
    # LAVA has evolved its invoice/contract terminology. We accept only known
    # documented identifiers, and still require a local Payment match before
    # any entitlement may ever be granted by the activation patch.
    return str(
        payload.get("invoiceId")
        or payload.get("invoice_id")
        or payload.get("contractId")
        or payload.get("contract_id")
        or payload.get("id")
        or ""
    ).strip()


def validate_payment_success_envelope(payload: Mapping[str, Any], x_api_key: str | None) -> str:
    """Authenticate and minimally validate a LAVA payment.success webhook.

    This readiness layer deliberately does not grant entitlements yet. The live
    activation patch will bind the real webhook example from the verified LAVA
    account to the existing Payment ledger and validate amount/currency before
    changing a workspace subscription.
    """
    require_webhook_api_key(x_api_key)
    if webhook_event_type(payload) != "payment.success":
        raise HTTPException(status_code=422, detail="Unsupported LAVA webhook event")
    invoice_id = webhook_invoice_id(payload)
    if not invoice_id:
        raise HTTPException(status_code=422, detail="LAVA webhook is missing invoice identity")
    return invoice_id
