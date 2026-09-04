from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

import auth
import crud
import entitlements
import models
import security
from database import get_db
from settings import Settings, get_settings


router = APIRouter(prefix="/api/control", tags=["control"])
ADMIN_ELEVATION_COOKIE = "vibeus_admin_elevation"
ADMIN_GRANT_CAMPAIGN = "__admin_grant__"


ROADMAP = [
    {
        "area": "Customers",
        "title": "Customer 360 timeline",
        "status": "todo",
        "description": "Unified timeline from signup and attribution through projects, checkout, payments, feedback and product incidents.",
    },
    {
        "area": "Support",
        "title": "Internal notes and tags",
        "status": "todo",
        "description": "Founder-only notes and labels such as beta, VIP, early-adopter and payment-support without exposing them to customers.",
    },
    {
        "area": "Product",
        "title": "Error Center",
        "status": "todo",
        "description": "Sentry-like operational view across runtime error groups, affected projects, frequency, releases and linked tickets.",
    },
    {
        "area": "Revenue",
        "title": "Payment reconciliation",
        "status": "todo",
        "description": "Detect provider-paid/local-unpaid and local-entitled/provider-unpaid mismatches, then guide safe repair.",
    },
    {
        "area": "Privacy",
        "title": "Data requests",
        "status": "todo",
        "description": "Search, export, deletion and anonymisation workflow for personal-data requests with retention-aware audit evidence.",
    },
    {
        "area": "Growth",
        "title": "Cohorts and funnel",
        "status": "todo",
        "description": "Retention, landing-to-paid funnel, LTV, churn, promo ROI, source attribution and RU/global comparisons.",
    },
    {
        "area": "Product",
        "title": "Feature flags",
        "status": "todo",
        "description": "Target features to founder, beta workspaces, plans or bounded percentages without shipping to everyone.",
    },
    {
        "area": "Product",
        "title": "Announcements",
        "status": "todo",
        "description": "Account banners and maintenance messages targeted by plan, market or workspace.",
    },
    {
        "area": "Support",
        "title": "Read-only View as customer",
        "status": "todo",
        "description": "Diagnostic impersonation that forbids mutations, shows a permanent ADMIN DIAGNOSTIC MODE banner and audits every session.",
    },
    {
        "area": "Security",
        "title": "Passkey / MFA for platform admins",
        "status": "todo",
        "description": "Require a phishing-resistant second factor in addition to the short-lived password re-authentication implemented for MVP.",
    },
    {
        "area": "Founder",
        "title": "Founder shortcuts",
        "status": "todo",
        "description": "One-click support actions such as a personal promo, safe compensation grant, GitHub jump and customer support summary.",
    },
    {
        "area": "Revenue",
        "title": "Provider-side refund and cancellation adapters",
        "status": "todo",
        "description": "Initiate refund/cancel only through the selected live billing provider, never by mutating local ledger state alone.",
    },
]


class AdminElevateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(..., min_length=1, max_length=256)


class ReasonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(..., min_length=5, max_length=500)


class ManualGrantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tier: Literal["solo", "studio", "business"]
    duration_days: int = Field(default=30, ge=1, le=3660)
    reason: str = Field(..., min_length=5, max_length=500)


class PromoCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str | None = Field(default=None, min_length=4, max_length=64)
    tier: Literal["solo", "studio", "business"] = "solo"
    duration_days: int | None = Field(default=30, ge=1, le=3660)
    grants_lifetime: bool = False
    campaign: str | None = Field(default=None, max_length=80)
    max_uses: int = Field(default=1, ge=1, le=100000)
    expires_at: datetime | None = None


def _admin_emails(cfg: Settings) -> set[str]:
    raw = cfg.platform_admin_emails
    if isinstance(raw, str):
        values = raw.split(",")
    else:
        values = list(raw)
    return {str(item).strip().lower() for item in values if str(item).strip()}


def _control_cfg() -> Settings:
    cfg = get_settings()
    if not cfg.enable_control_center:
        raise HTTPException(status_code=404, detail="Control center is disabled")
    return cfg


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(raw: str) -> bytes:
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def _elevation_secret(cfg: Settings) -> bytes:
    return (cfg.token_pepper.get_secret_value() + ":vibeus-control-elevation:v1").encode("utf-8")


def _make_elevation_token(user: models.User, cfg: Settings) -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=cfg.control_elevation_minutes)
    payload = {
        "uid": user.id,
        "email": user.email.lower(),
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "nonce": secrets.token_hex(8),
    }
    body = _b64encode(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(_elevation_secret(cfg), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64encode(signature)}", expires


def _read_elevation(request: Request, user: models.User, cfg: Settings) -> dict | None:
    raw = request.cookies.get(ADMIN_ELEVATION_COOKIE)
    if not raw or "." not in raw:
        return None
    body, encoded_signature = raw.split(".", 1)
    expected = hmac.new(_elevation_secret(cfg), body.encode("ascii"), hashlib.sha256).digest()
    try:
        supplied = _b64decode(encoded_signature)
        if not hmac.compare_digest(expected, supplied):
            return None
        payload = json.loads(_b64decode(body).decode("utf-8"))
        if payload.get("uid") != user.id or str(payload.get("email", "")).lower() != user.email.lower():
            return None
        if int(payload.get("exp", 0)) <= int(datetime.now(timezone.utc).timestamp()):
            return None
        return payload
    except Exception:
        return None


async def require_platform_admin(
    user: models.User = Depends(auth.get_current_user),
) -> models.User:
    cfg = _control_cfg()
    if user.email.strip().lower() not in _admin_emails(cfg):
        raise HTTPException(status_code=403, detail="Platform admin access required")
    return user


async def require_elevated_platform_admin(
    request: Request,
    user: models.User = Depends(require_platform_admin),
) -> models.User:
    cfg = _control_cfg()
    if not _read_elevation(request, user, cfg):
        raise HTTPException(status_code=403, detail="Admin re-authentication required")
    return user


def _dt(value: datetime | None) -> str | None:
    if not value:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _payment_item(payment: models.Payment, refunded_minor: int = 0) -> dict:
    return {
        "id": payment.id,
        "provider": payment.provider,
        "provider_payment_id": payment.provider_payment_id,
        "workspace_id": payment.workspace_id,
        "plan": payment.plan,
        "amount_minor": int(payment.amount_minor or 0),
        "currency": payment.currency,
        "status": payment.status,
        "is_test": bool(payment.is_test),
        "tax_mode": payment.tax_mode,
        "fiscal_status": payment.fiscal_status,
        "receipt_url": payment.receipt_url,
        "buyer_email": payment.buyer_email,
        "refunded_minor": int(refunded_minor or 0),
        "created_at": _dt(payment.created_at),
        "processed_at": _dt(payment.processed_at),
        "refund_action": {
            "supported": False,
            "reason": "TODO: wire provider-side refund only after the canonical live billing adapter is selected.",
        },
    }


def _audit_item(event: models.AuditEvent) -> dict:
    return {
        "id": event.id,
        "event_type": event.event_type,
        "workspace_id": event.workspace_id,
        "project_id": event.project_id,
        "user_id": event.user_id,
        "details": event.details or {},
        "created_at": _dt(event.created_at),
    }


def _promo_item(promo: models.PromoCode, redemption_count: int = 0) -> dict:
    return {
        "id": promo.id,
        "tier": promo.tier,
        "duration_days": promo.duration_days,
        "grants_lifetime": bool(promo.grants_lifetime),
        "campaign": promo.campaign,
        "is_active": bool(promo.is_active),
        "max_uses": int(promo.max_uses or 0),
        "times_used": int(promo.times_used or 0),
        "redemption_count": int(redemption_count or 0),
        "expires_at": _dt(promo.expires_at),
        "created_at": _dt(promo.created_at),
        "code_visible": False,
    }


def _request_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _normalise_promo_code(raw: str) -> str:
    code = raw.strip().upper()
    if len(code) < 4 or len(code) > 64:
        raise HTTPException(status_code=422, detail="Promo code must contain 4-64 characters")
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
    if any(char not in allowed for char in code):
        raise HTTPException(status_code=422, detail="Promo code may contain only A-Z, 0-9, _ and -")
    return code


def _normalise_expiry(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    if value <= models.utcnow():
        raise HTTPException(status_code=422, detail="Promo expiry must be in the future")
    return value


@router.get("/me")
async def control_me(
    request: Request,
    user: models.User = Depends(require_platform_admin),
):
    cfg = _control_cfg()
    elevation = _read_elevation(request, user, cfg)
    return {
        "enabled": True,
        "email": user.email,
        "platform_admin": True,
        "elevated": bool(elevation),
        "elevation_expires_at": (
            datetime.fromtimestamp(int(elevation["exp"]), tz=timezone.utc).isoformat()
            if elevation
            else None
        ),
        "elevation_minutes": cfg.control_elevation_minutes,
    }


@router.post("/elevate")
async def elevate_admin(
    data: AdminElevateRequest,
    request: Request,
    response: Response,
    user: models.User = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    if not user.hashed_password:
        raise HTTPException(
            status_code=409,
            detail="Password re-authentication is unavailable for this account",
        )
    if not security.verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect password")

    cfg = _control_cfg()
    token, expires = _make_elevation_token(user, cfg)
    response.set_cookie(
        key=ADMIN_ELEVATION_COOKIE,
        value=token,
        max_age=cfg.control_elevation_minutes * 60,
        httponly=True,
        secure=cfg.environment in {"staging", "production", "quality_gate"},
        samesite="strict",
        path="/api/control",
    )
    db.add(models.AuditEvent(
        user_id=user.id,
        event_type="admin.elevation.created",
        ip_address=_request_ip(request),
        details={"expires_at": _dt(expires)},
    ))
    await db.commit()
    return {"elevated": True, "expires_at": _dt(expires)}


@router.post("/elevation/revoke")
async def revoke_admin_elevation(
    request: Request,
    response: Response,
    user: models.User = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    response.delete_cookie(ADMIN_ELEVATION_COOKIE, path="/api/control")
    db.add(models.AuditEvent(
        user_id=user.id,
        event_type="admin.elevation.revoked",
        ip_address=_request_ip(request),
        details={},
    ))
    await db.commit()
    return {"elevated": False}


@router.get("/overview")
async def overview(
    user: models.User = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    now = models.utcnow()
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)
    pending_cutoff = now - timedelta(minutes=15)

    async def count(stmt) -> int:
        return int((await db.execute(stmt)).scalar() or 0)

    users_total = await count(select(func.count(models.User.id)))
    users_24h = await count(select(func.count(models.User.id)).where(models.User.created_at >= day_ago))
    users_7d = await count(select(func.count(models.User.id)).where(models.User.created_at >= week_ago))
    workspaces_total = await count(select(func.count(models.Workspace.id)))
    projects_total = await count(
        select(func.count(models.Project.id)).where(models.Project.is_deleted == False)
    )
    paid_workspaces = await count(
        select(func.count(models.Workspace.id)).where(
            models.Workspace.subscription_tier != "free",
            models.Workspace.subscription_status == "active",
            or_(
                models.Workspace.is_lifetime_free == True,
                models.Workspace.current_period_end > now,
            ),
        )
    )
    payments_24h = await count(
        select(func.count(models.Payment.id)).where(models.Payment.created_at >= day_ago)
    )
    pending_payments = await count(
        select(func.count(models.Payment.id)).where(
            models.Payment.status == "pending",
            models.Payment.created_at <= pending_cutoff,
        )
    )
    fiscal_attention = await count(
        select(func.count(models.Payment.id)).where(
            models.Payment.fiscal_status.in_(["receipt_required", "receipt_refund_required"])
        )
    )
    open_errors = await count(
        select(func.count(models.ErrorGroup.id)).where(models.ErrorGroup.status == "open")
    )
    promo_redemptions_30d = await count(
        select(func.count(models.PromoRedemption.id)).where(
            models.PromoRedemption.redeemed_at >= month_ago
        )
    )

    gross_rows = (await db.execute(
        select(models.Payment.currency, func.coalesce(func.sum(models.Payment.amount_minor), 0))
        .where(
            models.Payment.status == "succeeded",
            models.Payment.is_test == False,
            models.Payment.created_at >= month_ago,
        )
        .group_by(models.Payment.currency)
    )).all()
    refund_rows = (await db.execute(
        select(models.PaymentRefund.currency, func.coalesce(func.sum(models.PaymentRefund.amount_minor), 0))
        .join(models.Payment, models.Payment.id == models.PaymentRefund.payment_id)
        .where(
            models.PaymentRefund.status == "succeeded",
            models.Payment.is_test == False,
            models.PaymentRefund.created_at >= month_ago,
        )
        .group_by(models.PaymentRefund.currency)
    )).all()
    gross = {str(currency): int(amount or 0) for currency, amount in gross_rows}
    refunds = {str(currency): int(amount or 0) for currency, amount in refund_rows}
    currencies = sorted(set(gross) | set(refunds))
    revenue_30d = {
        currency: {
            "gross_minor": gross.get(currency, 0),
            "refund_minor": refunds.get(currency, 0),
            "net_minor": gross.get(currency, 0) - refunds.get(currency, 0),
        }
        for currency in currencies
    }

    recent = list((await db.execute(
        select(models.AuditEvent).order_by(models.AuditEvent.created_at.desc()).limit(12)
    )).scalars().all())

    return {
        "users": {"total": users_total, "new_24h": users_24h, "new_7d": users_7d},
        "workspaces": {"total": workspaces_total, "active_paid": paid_workspaces},
        "projects": {"total": projects_total},
        "billing": {
            "payments_24h": payments_24h,
            "pending_attention": pending_payments,
            "fiscal_attention": fiscal_attention,
            "revenue_30d_by_currency": revenue_30d,
        },
        "runtime": {"open_error_groups": open_errors},
        "growth": {"promo_redemptions_30d": promo_redemptions_30d},
        "recent_activity": [_audit_item(item) for item in recent],
        "viewer": user.email,
    }


@router.get("/customers")
async def search_customers(
    q: str = Query(default="", max_length=160),
    limit: int = Query(default=30, ge=1, le=100),
    user: models.User = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    query = q.strip()
    user_stmt = select(models.User)
    workspace_stmt = select(models.Workspace)
    project_stmt = select(models.Project).where(models.Project.is_deleted == False)
    if query:
        needle = f"%{query}%"
        user_stmt = user_stmt.where(or_(models.User.email.ilike(needle), models.User.id.ilike(needle)))
        workspace_stmt = workspace_stmt.where(or_(
            models.Workspace.name.ilike(needle),
            models.Workspace.owner_email.ilike(needle),
            models.Workspace.id.ilike(needle),
        ))
        project_stmt = project_stmt.where(or_(
            models.Project.name.ilike(needle),
            models.Project.slug.ilike(needle),
            models.Project.id.ilike(needle),
        ))
    users = list((await db.execute(user_stmt.order_by(models.User.created_at.desc()).limit(limit))).scalars().all())
    workspaces = list((await db.execute(workspace_stmt.order_by(models.Workspace.created_at.desc()).limit(limit))).scalars().all())
    projects = list((await db.execute(project_stmt.order_by(models.Project.created_at.desc()).limit(limit))).scalars().all())
    return {
        "query": query,
        "users": [
            {
                "id": item.id,
                "email": item.email,
                "is_active": bool(item.is_active),
                "created_at": _dt(item.created_at),
            }
            for item in users
        ],
        "workspaces": [
            {
                "id": item.id,
                "name": item.name,
                "owner_email": item.owner_email,
                "subscription_tier": item.subscription_tier,
                "effective_tier": entitlements.effective_tier(item),
                "subscription_status": item.subscription_status,
                "first_touch_source": item.first_touch_source,
                "created_at": _dt(item.created_at),
            }
            for item in workspaces
        ],
        "projects": [
            {
                "id": item.id,
                "workspace_id": item.workspace_id,
                "name": item.name,
                "slug": item.slug,
                "created_at": _dt(item.created_at),
            }
            for item in projects
        ],
    }


@router.get("/users/{user_id}")
async def user_detail(
    user_id: str,
    user: models.User = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    target = (await db.execute(
        select(models.User).where(models.User.id == user_id)
    )).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    membership_rows = (await db.execute(
        select(models.WorkspaceMembership, models.Workspace)
        .join(models.Workspace, models.Workspace.id == models.WorkspaceMembership.workspace_id)
        .where(models.WorkspaceMembership.user_id == target.id)
        .order_by(models.Workspace.created_at.asc())
    )).all()
    workspace_ids = [workspace.id for _, workspace in membership_rows]
    projects = []
    if workspace_ids:
        projects = list((await db.execute(
            select(models.Project)
            .where(
                models.Project.workspace_id.in_(workspace_ids),
                models.Project.is_deleted == False,
            )
            .order_by(models.Project.created_at.desc())
        )).scalars().all())

    active_sessions = int((await db.execute(
        select(func.count(models.Session.id)).where(
            models.Session.user_id == target.id,
            models.Session.revoked_at.is_(None),
            models.Session.expires_at > models.utcnow(),
        )
    )).scalar() or 0)

    event_conditions = [models.AuditEvent.user_id == target.id]
    if workspace_ids:
        event_conditions.append(models.AuditEvent.workspace_id.in_(workspace_ids))
    events = list((await db.execute(
        select(models.AuditEvent)
        .where(or_(*event_conditions))
        .order_by(models.AuditEvent.created_at.desc())
        .limit(30)
    )).scalars().all())

    return {
        "user": {
            "id": target.id,
            "email": target.email,
            "is_active": bool(target.is_active),
            "terms_version": target.terms_version,
            "terms_accepted_at": _dt(target.terms_accepted_at),
            "privacy_version": target.privacy_version,
            "privacy_acknowledged_at": _dt(target.privacy_acknowledged_at),
            "created_at": _dt(target.created_at),
            "active_sessions": active_sessions,
        },
        "workspaces": [
            {
                "id": workspace.id,
                "name": workspace.name,
                "role": membership.role,
                "effective_tier": entitlements.effective_tier(workspace),
                "subscription_tier": workspace.subscription_tier,
                "subscription_status": workspace.subscription_status,
                "period_end": _dt(workspace.current_period_end),
                "first_touch_source": workspace.first_touch_source,
            }
            for membership, workspace in membership_rows
        ],
        "projects": [
            {
                "id": project.id,
                "workspace_id": project.workspace_id,
                "name": project.name,
                "slug": project.slug,
                "created_at": _dt(project.created_at),
            }
            for project in projects
        ],
        "recent_activity": [_audit_item(event) for event in events],
    }


async def _target_user_locked(db: AsyncSession, user_id: str) -> models.User:
    target = (await db.execute(
        select(models.User).where(models.User.id == user_id).with_for_update()
    )).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    return target


async def _revoke_user_sessions(db: AsyncSession, user_id: str) -> int:
    sessions = list((await db.execute(
        select(models.Session).where(
            models.Session.user_id == user_id,
            models.Session.revoked_at.is_(None),
        ).with_for_update()
    )).scalars().all())
    now = models.utcnow()
    for session in sessions:
        session.revoked_at = now
    return len(sessions)


@router.post("/users/{user_id}/block")
async def block_user(
    user_id: str,
    data: ReasonRequest,
    request: Request,
    admin: models.User = Depends(require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    if user_id == admin.id:
        raise HTTPException(status_code=409, detail="A platform admin cannot block their own account")
    target = await _target_user_locked(db, user_id)
    revoked = await _revoke_user_sessions(db, user_id)
    target.is_active = False
    db.add(models.AuditEvent(
        user_id=admin.id,
        event_type="admin.user.blocked",
        ip_address=_request_ip(request),
        details={"target_user_id": target.id, "target_email": target.email, "reason": data.reason, "sessions_revoked": revoked},
    ))
    await db.commit()
    return {"id": target.id, "is_active": False, "sessions_revoked": revoked}


@router.post("/users/{user_id}/unblock")
async def unblock_user(
    user_id: str,
    data: ReasonRequest,
    request: Request,
    admin: models.User = Depends(require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    target = await _target_user_locked(db, user_id)
    target.is_active = True
    db.add(models.AuditEvent(
        user_id=admin.id,
        event_type="admin.user.unblocked",
        ip_address=_request_ip(request),
        details={"target_user_id": target.id, "target_email": target.email, "reason": data.reason},
    ))
    await db.commit()
    return {"id": target.id, "is_active": True}


@router.post("/users/{user_id}/sessions/revoke")
async def revoke_user_sessions(
    user_id: str,
    data: ReasonRequest,
    request: Request,
    admin: models.User = Depends(require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    if user_id == admin.id:
        raise HTTPException(status_code=409, detail="Use normal logout for the current platform-admin session")
    target = await _target_user_locked(db, user_id)
    revoked = await _revoke_user_sessions(db, target.id)
    db.add(models.AuditEvent(
        user_id=admin.id,
        event_type="admin.user.sessions_revoked",
        ip_address=_request_ip(request),
        details={"target_user_id": target.id, "target_email": target.email, "reason": data.reason, "sessions_revoked": revoked},
    ))
    await db.commit()
    return {"id": target.id, "sessions_revoked": revoked}


@router.get("/workspaces/{workspace_id}")
async def workspace_detail(
    workspace_id: str,
    user: models.User = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    workspace = (await db.execute(
        select(models.Workspace).where(models.Workspace.id == workspace_id)
    )).scalar_one_or_none()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    member_rows = (await db.execute(
        select(models.WorkspaceMembership, models.User)
        .join(models.User, models.User.id == models.WorkspaceMembership.user_id)
        .where(models.WorkspaceMembership.workspace_id == workspace.id)
    )).all()
    projects = list((await db.execute(
        select(models.Project)
        .where(models.Project.workspace_id == workspace.id, models.Project.is_deleted == False)
        .order_by(models.Project.created_at.desc())
    )).scalars().all())
    payments = list((await db.execute(
        select(models.Payment)
        .where(models.Payment.workspace_id == workspace.id)
        .order_by(models.Payment.created_at.desc())
        .limit(50)
    )).scalars().all())
    refund_rows = (await db.execute(
        select(models.PaymentRefund.payment_id, func.coalesce(func.sum(models.PaymentRefund.amount_minor), 0))
        .where(models.PaymentRefund.payment_id.in_([payment.id for payment in payments] or ["__none__"]))
        .group_by(models.PaymentRefund.payment_id)
    )).all()
    refunded = {payment_id: int(amount or 0) for payment_id, amount in refund_rows}
    redemptions = (await db.execute(
        select(models.PromoRedemption, models.PromoCode)
        .join(models.PromoCode, models.PromoCode.id == models.PromoRedemption.promo_code_id)
        .where(models.PromoRedemption.workspace_id == workspace.id)
        .order_by(models.PromoRedemption.redeemed_at.desc())
        .limit(50)
    )).all()
    events = list((await db.execute(
        select(models.AuditEvent)
        .where(models.AuditEvent.workspace_id == workspace.id)
        .order_by(models.AuditEvent.created_at.desc())
        .limit(50)
    )).scalars().all())

    return {
        "workspace": {
            "id": workspace.id,
            "name": workspace.name,
            "owner_email": workspace.owner_email,
            "subscription_tier": workspace.subscription_tier,
            "effective_tier": entitlements.effective_tier(workspace),
            "subscription_status": workspace.subscription_status,
            "current_period_start": _dt(workspace.current_period_start),
            "current_period_end": _dt(workspace.current_period_end),
            "cancel_at_period_end": bool(workspace.cancel_at_period_end),
            "billing_provider": workspace.billing_provider,
            "is_lifetime_free": bool(workspace.is_lifetime_free),
            "first_touch_source": workspace.first_touch_source,
            "first_touch_at": _dt(workspace.first_touch_at),
            "created_at": _dt(workspace.created_at),
        },
        "members": [
            {
                "user_id": member.id,
                "email": member.email,
                "role": membership.role,
                "is_active": bool(member.is_active),
            }
            for membership, member in member_rows
        ],
        "projects": [
            {
                "id": project.id,
                "name": project.name,
                "slug": project.slug,
                "created_at": _dt(project.created_at),
            }
            for project in projects
        ],
        "payments": [_payment_item(payment, refunded.get(payment.id, 0)) for payment in payments],
        "promo_redemptions": [
            {
                "id": redemption.id,
                "promo_id": promo.id,
                "campaign": promo.campaign,
                "tier": redemption.tier,
                "duration_days": redemption.duration_days,
                "redeemed_at": _dt(redemption.redeemed_at),
            }
            for redemption, promo in redemptions
        ],
        "recent_activity": [_audit_item(event) for event in events],
    }


@router.post("/workspaces/{workspace_id}/grant-access")
async def grant_workspace_access(
    workspace_id: str,
    data: ManualGrantRequest,
    request: Request,
    admin: models.User = Depends(require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    workspace = (await db.execute(
        select(models.Workspace).where(models.Workspace.id == workspace_id)
    )).scalar_one_or_none()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    raw_code = f"ADM-{secrets.token_hex(12).upper()}"
    promo = models.PromoCode(
        code_digest=security.hash_access_token(raw_code),
        tier=data.tier,
        duration_days=data.duration_days,
        grants_lifetime=False,
        campaign=ADMIN_GRANT_CAMPAIGN,
        is_active=True,
        max_uses=1,
        times_used=0,
        expires_at=models.utcnow() + timedelta(minutes=10),
    )
    db.add(promo)
    await db.flush()

    owner_id = (await db.execute(
        select(models.User.id)
        .join(models.WorkspaceMembership, models.WorkspaceMembership.user_id == models.User.id)
        .where(
            models.WorkspaceMembership.workspace_id == workspace.id,
            models.WorkspaceMembership.role == "owner",
        )
        .limit(1)
    )).scalar_one_or_none()

    updated, _ = await crud.redeem_promo_code(
        db,
        workspace.id,
        raw_code,
        user_id=owner_id,
    )
    db.add(models.AuditEvent(
        workspace_id=workspace.id,
        user_id=admin.id,
        event_type="admin.entitlement.granted",
        ip_address=_request_ip(request),
        details={
            "tier": data.tier,
            "duration_days": data.duration_days,
            "reason": data.reason,
            "mechanism": "internal_one_time_promo",
        },
    ))
    await db.commit()
    await db.refresh(updated)
    return {
        "workspace_id": updated.id,
        "effective_tier": entitlements.effective_tier(updated),
        "subscription_tier": updated.subscription_tier,
        "current_period_end": _dt(updated.current_period_end),
    }


@router.get("/payments")
async def list_payments(
    status: str | None = Query(default=None, max_length=32),
    provider: str | None = Query(default=None, max_length=32),
    workspace_id: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=100, ge=1, le=500),
    user: models.User = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(models.Payment)
    if status:
        stmt = stmt.where(models.Payment.status == status)
    if provider:
        stmt = stmt.where(models.Payment.provider == provider)
    if workspace_id:
        stmt = stmt.where(models.Payment.workspace_id == workspace_id)
    payments = list((await db.execute(
        stmt.order_by(models.Payment.created_at.desc()).limit(limit)
    )).scalars().all())
    ids = [item.id for item in payments]
    refund_rows = []
    if ids:
        refund_rows = (await db.execute(
            select(models.PaymentRefund.payment_id, func.coalesce(func.sum(models.PaymentRefund.amount_minor), 0))
            .where(models.PaymentRefund.payment_id.in_(ids))
            .group_by(models.PaymentRefund.payment_id)
        )).all()
    refunded = {payment_id: int(amount or 0) for payment_id, amount in refund_rows}
    return {"payments": [_payment_item(item, refunded.get(item.id, 0)) for item in payments]}


@router.get("/promos")
async def list_promos(
    include_internal: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    user: models.User = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(models.PromoCode)
    if not include_internal:
        stmt = stmt.where(or_(
            models.PromoCode.campaign.is_(None),
            models.PromoCode.campaign != ADMIN_GRANT_CAMPAIGN,
        ))
    promos = list((await db.execute(
        stmt.order_by(models.PromoCode.created_at.desc()).limit(limit)
    )).scalars().all())
    ids = [promo.id for promo in promos]
    redemption_rows = []
    if ids:
        redemption_rows = (await db.execute(
            select(models.PromoRedemption)
            .where(models.PromoRedemption.promo_code_id.in_(ids))
            .order_by(models.PromoRedemption.redeemed_at.desc())
        )).scalars().all()
    by_promo: dict[str, list[models.PromoRedemption]] = {}
    for redemption in redemption_rows:
        by_promo.setdefault(redemption.promo_code_id, []).append(redemption)
    return {
        "promos": [
            {
                **_promo_item(promo, len(by_promo.get(promo.id, []))),
                "recent_redemptions": [
                    {
                        "workspace_id": redemption.workspace_id,
                        "user_id": redemption.user_id,
                        "tier": redemption.tier,
                        "duration_days": redemption.duration_days,
                        "redeemed_at": _dt(redemption.redeemed_at),
                    }
                    for redemption in by_promo.get(promo.id, [])[:10]
                ],
            }
            for promo in promos
        ]
    }


@router.post("/promos")
async def create_promo(
    data: PromoCreateRequest,
    request: Request,
    admin: models.User = Depends(require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    if data.grants_lifetime:
        duration_days = None
    else:
        duration_days = data.duration_days or 30
    raw_code = _normalise_promo_code(data.code) if data.code else f"VIBE-{secrets.token_hex(4).upper()}"
    digest = security.hash_access_token(raw_code)
    exists = (await db.execute(
        select(models.PromoCode.id).where(models.PromoCode.code_digest == digest)
    )).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Promo code already exists")

    expires_at = _normalise_expiry(data.expires_at)
    promo = models.PromoCode(
        code_digest=digest,
        tier=data.tier,
        duration_days=duration_days,
        grants_lifetime=data.grants_lifetime,
        campaign=(data.campaign or "").strip() or None,
        is_active=True,
        max_uses=data.max_uses,
        times_used=0,
        expires_at=expires_at,
    )
    db.add(promo)
    await db.flush()
    db.add(models.AuditEvent(
        user_id=admin.id,
        event_type="admin.promo.created",
        ip_address=_request_ip(request),
        details={
            "promo_id": promo.id,
            "campaign": promo.campaign,
            "tier": promo.tier,
            "duration_days": promo.duration_days,
            "grants_lifetime": bool(promo.grants_lifetime),
            "max_uses": promo.max_uses,
            "expires_at": _dt(promo.expires_at),
        },
    ))
    await db.commit()
    await db.refresh(promo)
    base = str(_control_cfg().public_base_url).rstrip("/")
    return {
        "promo": _promo_item(promo),
        "plaintext_code": raw_code,
        "plaintext_visible_once": True,
        "share_url": f"{base}/create?promo={quote(raw_code)}",
    }


@router.post("/promos/{promo_id}/deactivate")
async def deactivate_promo(
    promo_id: str,
    data: ReasonRequest,
    request: Request,
    admin: models.User = Depends(require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    promo = (await db.execute(
        select(models.PromoCode).where(models.PromoCode.id == promo_id).with_for_update()
    )).scalar_one_or_none()
    if not promo:
        raise HTTPException(status_code=404, detail="Promo code not found")
    promo.is_active = False
    db.add(models.AuditEvent(
        user_id=admin.id,
        event_type="admin.promo.deactivated",
        ip_address=_request_ip(request),
        details={"promo_id": promo.id, "campaign": promo.campaign, "reason": data.reason},
    ))
    await db.commit()
    return {"id": promo.id, "is_active": False}


@router.post("/promos/{promo_id}/activate")
async def activate_promo(
    promo_id: str,
    data: ReasonRequest,
    request: Request,
    admin: models.User = Depends(require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    promo = (await db.execute(
        select(models.PromoCode).where(models.PromoCode.id == promo_id).with_for_update()
    )).scalar_one_or_none()
    if not promo:
        raise HTTPException(status_code=404, detail="Promo code not found")
    if promo.expires_at and promo.expires_at <= models.utcnow():
        raise HTTPException(status_code=409, detail="Expired promo cannot be reactivated")
    if int(promo.times_used or 0) >= int(promo.max_uses or 0):
        raise HTTPException(status_code=409, detail="Exhausted promo cannot be reactivated")
    promo.is_active = True
    db.add(models.AuditEvent(
        user_id=admin.id,
        event_type="admin.promo.activated",
        ip_address=_request_ip(request),
        details={"promo_id": promo.id, "campaign": promo.campaign, "reason": data.reason},
    ))
    await db.commit()
    return {"id": promo.id, "is_active": True}


@router.get("/projects/{project_id}")
async def project_detail(
    project_id: str,
    user: models.User = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    project = (await db.execute(
        select(models.Project).where(models.Project.id == project_id, models.Project.is_deleted == False)
    )).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    feedback_count = int((await db.execute(
        select(func.count(models.Feedback.id)).where(models.Feedback.project_id == project.id)
    )).scalar() or 0)
    open_errors = int((await db.execute(
        select(func.count(models.ErrorGroup.id)).where(
            models.ErrorGroup.project_id == project.id,
            models.ErrorGroup.status == "open",
        )
    )).scalar() or 0)
    ticket_count = int((await db.execute(
        select(func.count(models.SpecTicket.id))
        .join(models.SpecNode, models.SpecNode.id == models.SpecTicket.node_id)
        .where(
            models.SpecNode.project_id == project.id,
            models.SpecTicket.is_deleted == False,
        )
    )).scalar() or 0)
    recent_errors = list((await db.execute(
        select(models.ErrorGroup)
        .where(models.ErrorGroup.project_id == project.id)
        .order_by(models.ErrorGroup.last_seen_at.desc())
        .limit(10)
    )).scalars().all())
    events = list((await db.execute(
        select(models.AuditEvent)
        .where(models.AuditEvent.project_id == project.id)
        .order_by(models.AuditEvent.created_at.desc())
        .limit(30)
    )).scalars().all())

    return {
        "project": {
            "id": project.id,
            "workspace_id": project.workspace_id,
            "name": project.name,
            "slug": project.slug,
            "description": project.description or "",
            "public_widget_key": project.public_widget_key,
            "public_widget_origins": project.public_widget_origins or [],
            "api_token_configured": bool(project.api_token_digest),
            "ingest_key_configured": bool(project.ingest_key_digest),
            "telemetry_enabled": bool(project.telemetry_enabled),
            "ai_data_sharing": bool(project.ai_data_sharing),
            "runtime_error_tracking_enabled": bool(project.runtime_error_tracking_enabled),
            "github_repo": project.github_repo,
            "github_sync_enabled": bool(project.github_sync_enabled),
            "github_pat_fallback_configured": bool(project.github_token_encrypted),
            "created_at": _dt(project.created_at),
        },
        "counts": {
            "feedback": feedback_count,
            "tickets": ticket_count,
            "open_error_groups": open_errors,
        },
        "recent_errors": [
            {
                "id": item.id,
                "exception_type": item.exception_type,
                "normalized_message": item.normalized_message,
                "route": item.route,
                "status": item.status,
                "occurrences_count": int(item.occurrences_count or 0),
                "last_seen_at": _dt(item.last_seen_at),
            }
            for item in recent_errors
        ],
        "recent_activity": [_audit_item(event) for event in events],
        "secret_policy": {
            "api_token": "never displayed in Control Center",
            "ingest_key": "never displayed in Control Center",
            "public_widget_key": "browser-visible credential; display is allowed",
        },
    }


@router.post("/projects/{project_id}/revoke-api-token")
async def revoke_project_api_token(
    project_id: str,
    data: ReasonRequest,
    request: Request,
    admin: models.User = Depends(require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    project = (await db.execute(
        select(models.Project).where(models.Project.id == project_id, models.Project.is_deleted == False).with_for_update()
    )).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.api_token_digest = None
    db.add(models.AuditEvent(
        workspace_id=project.workspace_id,
        project_id=project.id,
        user_id=admin.id,
        event_type="admin.project.api_token_revoked",
        ip_address=_request_ip(request),
        details={"reason": data.reason},
    ))
    await db.commit()
    return {"project_id": project.id, "api_token_configured": False}


@router.post("/projects/{project_id}/revoke-ingest-key")
async def revoke_project_ingest_key(
    project_id: str,
    data: ReasonRequest,
    request: Request,
    admin: models.User = Depends(require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    project = (await db.execute(
        select(models.Project).where(models.Project.id == project_id, models.Project.is_deleted == False).with_for_update()
    )).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.ingest_key_digest = None
    project.runtime_error_tracking_enabled = False
    db.add(models.AuditEvent(
        workspace_id=project.workspace_id,
        project_id=project.id,
        user_id=admin.id,
        event_type="admin.project.ingest_key_revoked",
        ip_address=_request_ip(request),
        details={"reason": data.reason},
    ))
    await db.commit()
    return {
        "project_id": project.id,
        "ingest_key_configured": False,
        "runtime_error_tracking_enabled": False,
    }


@router.get("/audit")
async def audit_log(
    event_type: str | None = Query(default=None, max_length=128),
    workspace_id: str | None = Query(default=None, max_length=128),
    actor_user_id: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=100, ge=1, le=500),
    user: models.User = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(models.AuditEvent)
    if event_type:
        if event_type.endswith("*"):
            stmt = stmt.where(models.AuditEvent.event_type.like(event_type[:-1] + "%"))
        else:
            stmt = stmt.where(models.AuditEvent.event_type == event_type)
    if workspace_id:
        stmt = stmt.where(models.AuditEvent.workspace_id == workspace_id)
    if actor_user_id:
        stmt = stmt.where(models.AuditEvent.user_id == actor_user_id)
    events = list((await db.execute(
        stmt.order_by(models.AuditEvent.created_at.desc()).limit(limit)
    )).scalars().all())
    return {"events": [_audit_item(event) for event in events]}


@router.get("/operations")
async def operations(
    user: models.User = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    cfg = _control_cfg()
    database_ok = True
    database_error = None
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:
        database_ok = False
        database_error = type(exc).__name__

    pending_older_15m = int((await db.execute(
        select(func.count(models.Payment.id)).where(
            models.Payment.status == "pending",
            models.Payment.created_at <= models.utcnow() - timedelta(minutes=15),
        )
    )).scalar() or 0)
    fiscal_attention = int((await db.execute(
        select(func.count(models.Payment.id)).where(
            models.Payment.fiscal_status.in_(["receipt_required", "receipt_refund_required"])
        )
    )).scalar() or 0)
    open_runtime_errors = int((await db.execute(
        select(func.count(models.ErrorGroup.id)).where(models.ErrorGroup.status == "open")
    )).scalar() or 0)

    return {
        "service": "VibeUs Cloud",
        "version": "2.4.0",
        "environment": cfg.environment,
        "database": {"ok": database_ok, "error": database_error},
        "billing": {
            "global_provider": cfg.global_billing_provider,
            "global_pricing_enabled": cfg.enable_global_pricing,
            "mock_billing_enabled": cfg.enable_mock_billing,
            "providers": {
                "yookassa": cfg.enable_yookassa,
                "cloudpayments": cfg.enable_cloudpayments,
                "stripe": cfg.enable_stripe,
                "lava": cfg.enable_lava,
            },
            "pending_older_15m": pending_older_15m,
            "fiscal_attention": fiscal_attention,
        },
        "runtime": {"open_error_groups": open_runtime_errors},
        "control": {
            "enabled": cfg.enable_control_center,
            "admin_count": len(_admin_emails(cfg)),
            "elevation_minutes": cfg.control_elevation_minutes,
        },
        "secrets_exposed": False,
    }


@router.get("/roadmap")
async def roadmap(
    user: models.User = Depends(require_platform_admin),
):
    return {
        "phase": "post-mvp",
        "policy": "Visible placeholders only. Do not silently enable unfinished mutations.",
        "items": ROADMAP,
    }
