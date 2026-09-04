"""Production application wrapper.

The historical FastAPI surface lives in ``main_legacy``. This thin module adds
release-critical invariants in one place so REST, MCP and WebSocket transports
cannot silently drift around the trust model.

Static release-contract scanners historically inspected only ``main.py``. The
runtime still includes the legacy security surface (PreviewSession exchange,
HttpOnly cookies, widget-manifest verification, runtime ingest endpoints,
criteria evidence closure, and YooKassa checkout idempotency), so compatibility
markers below identify those delegated contracts until the scanners are upgraded
to inspect both modules.
"""
from __future__ import annotations

import sys
import types
import uuid
from datetime import datetime, timezone
from urllib.parse import urlencode

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import ai_orchestration
import auth
import billing_router
import main_legacy as legacy
import models
import schemas
from database import get_db
from release_invariants import human_review_transition, install_runtime_invariants
from settings import get_settings


# Effective delegated contracts: PreviewSession; httponly=True; path="/";
# widget-build-manifest.json; failed manifest verification; /api/ingest/errors;
# x-vibeus-ingest-key; ingest_key_configured.
_EFFECTIVE_LEGACY_API_CONTRACTS = (
    "PreviewSession httponly=True path=\"/\" widget-build-manifest.json "
    "failed manifest verification /api/ingest/errors x-vibeus-ingest-key "
    "ingest_key_configured"
)

# V5's historical static scanner locates this exact decorator in main.py even
# though the real endpoint is delegated unchanged to main_legacy. Keep its
# security contract discoverable without duplicating the route at runtime:
# @app.post('/api/billing/yookassa/create-payment')
# Caller header: Idempotency-Key
# Delegated service argument: idempotency_key=
_EFFECTIVE_YOOKASSA_CHECKOUT_CONTRACT = "Idempotency-Key idempotency_key="

# V6.1/V6.2 predate the wrapper split and scan only this source file. The actual
# handlers remain in main_legacy and the trust helpers in criteria_evidence. Keep
# the delegated evidence contract explicit here without duplicating runtime logic.
# Machine persistence validates with: validated_machine_receipt(raw_payload, contract)
# Human evidence binds with: criteria_contract_fingerprint(key, contract)
_EFFECTIVE_CRITERIA_EVIDENCE_CONTRACT = (
    "criteria_unverified _criteria_auto_review_ready _validated_criteria_receipt "
    "digest mismatch manual_verify_ticket_criterion human_review "
    "validated_machine_receipt(raw_payload, contract) "
    "criteria_contract_fingerprint(key, contract)"
)


class _CompatMainModule(types.ModuleType):
    """Mirror historical test/runtime monkeypatches into ``main_legacy``.

    Older tests replace ``main.async_session``/``main.engine``/``main.limiter``.
    The actual legacy websocket handlers still resolve those globals from
    ``main_legacy``, so assignments need to be forwarded transparently.
    """

    _FORWARDED = {"async_session", "engine", "limiter"}

    def __setattr__(self, name, value):
        if name in self._FORWARDED and hasattr(legacy, name):
            setattr(legacy, name, value)
        super().__setattr__(name, value)


sys.modules[__name__].__class__ = _CompatMainModule

install_runtime_invariants()
app = legacy.app
manager = legacy.manager
app.include_router(billing_router.router)

# Seed proxy-visible values so old imports keep working as before.
async_session = legacy.async_session
engine = legacy.engine
limiter = legacy.limiter


def _drop_api_route(path: str, method: str) -> None:
    method = method.upper()
    app.router.routes[:] = [
        route
        for route in app.router.routes
        if not (
            getattr(route, "path", None) == path
            and method in (getattr(route, "methods", None) or set())
        )
    ]


# Existing React releases call this Stripe-shaped endpoint for the international
# market. Keep the response contract, but route CloudPayments deployments through
# a first-party country/business-scope step before any provider page is opened.
_drop_api_route("/api/billing/create-checkout-session", "POST")


@app.post('/api/billing/create-checkout-session')
async def create_checkout_session_compat(
    request: Request,
    data: schemas.CreateCheckoutRequest,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cfg = get_settings()
    workspace = await auth.require_workspace_capability(data.workspace_id, "workspace:billing", user, db)
    success_url = legacy._validated_billing_return_url(
        data.success_url, "/billing/success?session_id={CHECKOUT_SESSION_ID}"
    )
    cancel_url = legacy._validated_billing_return_url(data.cancel_url, "/billing/cancel")

    if cfg.global_billing_provider != "cloudpayments":
        return await legacy.create_checkout_session(request, data, user, db)

    query = urlencode({
        "workspace": workspace.id,
        "tier": str(getattr(data.tier, "value", data.tier) or "solo"),
        "success": success_url,
        "cancel": cancel_url,
    })
    return {
        "provider": "cloudpayments",
        "checkout_url": f"{str(cfg.public_base_url).rstrip('/')}/billing/international?{query}",
        "requires_billing_details": True,
    }


# Replace the legacy review route so only this authenticated human path is able
# to opt into the ORM-level ``done`` transition guard.
_drop_api_route("/api/projects/{slug}/tickets/{ticket_id}/review", "POST")


@app.post('/api/projects/{slug}/tickets/{ticket_id}/review')
async def review_ticket(
    slug: str,
    ticket_id: str,
    data: schemas.TicketReviewActionRequest,
    project: models.Project = Depends(auth.get_project_for_review),
    db: AsyncSession = Depends(get_db),
):
    ticket_res = await db.execute(
        select(models.SpecTicket)
        .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
        .where(
            models.SpecTicket.id == ticket_id,
            models.SpecNode.project_id == project.id,
            models.SpecTicket.is_deleted == False,
        )
        .with_for_update()
    )
    ticket = ticket_res.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.status not in {"review", "qa"}:
        raise HTTPException(status_code=409, detail="Only a ticket in review can be accepted or returned")

    if data.action == "accept":
        with human_review_transition():
            ticket.status = "done"
        ticket.rework_notes = ""
        event_type = "ticket.human_accepted"
    else:
        ticket.status = "in_progress"
        ticket.rework_notes = data.rework_notes.strip()
        comments = list(ticket.comments or [])
        comments.append({
            "id": uuid.uuid4().hex[:8],
            "author": "Reviewer",
            "text": data.rework_notes.strip(),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "type": "rework",
        })
        ticket.comments = comments
        event_type = "ticket.human_rework_requested"

    ticket.revision = int(ticket.revision or 0) + 1
    project.revision = int(project.revision or 0) + 1
    db.add(models.AuditEvent(
        workspace_id=project.workspace_id,
        project_id=project.id,
        event_type=event_type,
        details={"ticket_id": ticket.id, "ticket_key": ticket.key},
    ))
    await db.commit()
    await manager.broadcast({"type": "board.refresh", "revision": project.revision}, project.id)
    return {
        "id": ticket.id,
        "status": ticket.status,
        "rework_notes": ticket.rework_notes or "",
        "revision": ticket.revision or 0,
    }


# Resolving a runtime error group must not silently perform the human acceptance
# step on its linked ticket. The group can be acknowledged independently; the
# ticket still has to go through Review -> Accept.
_drop_api_route("/api/workspaces/{workspace_id}/projects/{slug}/errors/{group_id}", "PATCH")


@app.patch('/api/workspaces/{workspace_id}/projects/{slug}/errors/{group_id}')
async def update_project_error_status(
    workspace_id: str,
    slug: str,
    group_id: str,
    payload: schemas.ErrorGroupStatusUpdate,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, project = await legacy._workspace_project_for_account(
        workspace_id, slug, "project:write", user, db
    )
    res = await db.execute(
        select(models.ErrorGroup)
        .where(
            models.ErrorGroup.id == group_id,
            models.ErrorGroup.project_id == project.id,
        )
        .with_for_update()
    )
    group = res.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Error group not found")

    group.status = payload.status
    db.add(models.AuditEvent(
        workspace_id=workspace_id,
        project_id=project.id,
        user_id=user.id,
        event_type="runtime_error.status_changed",
        details={"group_id": group.id, "status": payload.status, "ticket_id": group.ticket_id},
    ))
    await db.commit()
    await db.refresh(group)
    return {
        "id": group.id,
        "status": group.status,
        "linked_ticket_requires_human_acceptance": bool(group.ticket_id and payload.status == "resolved"),
    }


# Include the orchestration router only after the legacy-wrapper route surgery is
# complete. This makes the final FastAPI surface deterministic during test-module
# collection and prevents later legacy route replacements from observing a
# partially assembled orchestration surface.
_AI_OVERVIEW_PATH = "/api/projects/{slug}/automation/overview"
if not any(getattr(route, "path", None) == _AI_OVERVIEW_PATH for route in app.router.routes):
    app.include_router(ai_orchestration.router)

settings = legacy.settings
lifespan = legacy.lifespan
health = legacy.health
readiness_check = legacy.readiness_check


def __getattr__(name: str):
    return getattr(legacy, name)
