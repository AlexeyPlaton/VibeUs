from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

import auth
import cloudpayments_refund_service
import cloudpayments_service
import models
import yookassa_service
from database import get_db
from settings import get_settings


router = APIRouter(prefix="/api/billing", tags=["billing"])

# Conservative first international hosted scope from the existing VibeUs legal
# launch audit. Billing country is contractual/tax input, never guessed from UI
# language or IP address.
EEA_AND_UK = {
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
    "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
    "SI", "ES", "SE", "IS", "LI", "NO", "GB",
}


class CheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workspace_id: str = Field(..., min_length=1, max_length=128)
    tier: Literal["solo", "studio"] = "solo"
    market: Literal["ru", "global"]
    success_url: str
    cancel_url: str
    billing_country: str | None = Field(default=None, min_length=2, max_length=2)
    business_use_confirmed: bool = False
    culture: Literal["ru-RU", "en-US"] = "en-US"


class CheckoutResponse(BaseModel):
    provider: str
    checkout_url: str
    payment_id: str | None = None
    invoice_id: str | None = None


def _country(value: str | None) -> str | None:
    return value.strip().upper() if value else None


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(
    request: Request,
    data: CheckoutRequest,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    import main_legacy as legacy

    cfg = get_settings()
    workspace = await auth.require_workspace_capability(
        data.workspace_id, "workspace:billing", user, db
    )
    success_url = legacy._validated_billing_return_url(data.success_url, "/billing/success")
    cancel_url = legacy._validated_billing_return_url(data.cancel_url, "/billing/cancel")

    if data.market == "ru":
        if not cfg.enable_yookassa and not cfg.enable_mock_billing:
            raise HTTPException(status_code=503, detail="Russian checkout is temporarily unavailable")
        payment = await yookassa_service.create_yookassa_payment(
            workspace_id=workspace.id,
            owner_email=workspace.owner_email,
            tier=data.tier,
            return_url=success_url,
            is_b2b=False,
            company_inn=None,
            company_name=None,
            db=db,
            idempotency_key=(request.headers.get("Idempotency-Key") or "").strip()[:64] or None,
        )
        return CheckoutResponse(
            provider="yookassa",
            checkout_url=payment["confirmation_url"],
            payment_id=payment.get("payment_id"),
            invoice_id=payment.get("provider_payment_id") or payment.get("id"),
        )

    country = _country(data.billing_country)
    if not country:
        raise HTTPException(status_code=422, detail="billing_country is required for international checkout")
    if country in EEA_AND_UK:
        raise HTTPException(
            status_code=451,
            detail="Hosted paid VibeUs is not yet offered in the EEA or UK; self-hosted VibeUs remains available",
        )
    if not data.business_use_confirmed:
        raise HTTPException(
            status_code=422,
            detail="International checkout currently requires business/professional-use confirmation",
        )

    # Immutable evidence of why this hosted international checkout was allowed.
    # Keeping it in the audit ledger avoids inferring country later from locale/IP
    # and makes tax/legal review possible even if provider metadata changes.
    db.add(models.AuditEvent(
        workspace_id=workspace.id,
        user_id=user.id,
        event_type="billing.international_scope_confirmed",
        details={
            "billing_country": country,
            "business_use_confirmed": True,
            "tier": data.tier,
            "provider": cfg.global_billing_provider,
        },
    ))
    await db.commit()

    provider = cfg.global_billing_provider
    if provider == "cloudpayments":
        result = await cloudpayments_service.create_order(
            db=db,
            workspace=workspace,
            tier=data.tier,
            success_url=success_url,
            fail_url=cancel_url,
            culture=data.culture,
        )
        return CheckoutResponse(**result)

    raise HTTPException(
        status_code=503,
        detail=f"Configured global billing provider '{provider}' is not enabled by the unified checkout",
    )


@router.post("/cloudpayments/check")
async def cloudpayments_check(request: Request, db: AsyncSession = Depends(get_db)):
    return await cloudpayments_service.process_check(await request.body(), request.headers, db)


@router.post("/cloudpayments/pay")
async def cloudpayments_pay(request: Request, db: AsyncSession = Depends(get_db)):
    return await cloudpayments_service.process_pay(await request.body(), request.headers, db)


@router.post("/cloudpayments/fail")
async def cloudpayments_fail(request: Request, db: AsyncSession = Depends(get_db)):
    return await cloudpayments_service.process_fail(await request.body(), request.headers, db)


@router.post("/cloudpayments/refund")
async def cloudpayments_refund(request: Request, db: AsyncSession = Depends(get_db)):
    return await cloudpayments_refund_service.process_refund(
        await request.body(), request.headers, db
    )
