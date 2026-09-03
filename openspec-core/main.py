"""Production application wrapper.

The historical FastAPI surface lives in ``main_legacy``.  This thin module adds
release-critical invariants in one place so REST, MCP and WebSocket transports
cannot silently drift around the trust model.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import auth
import main_legacy as legacy
import models
import schemas
from database import get_db
from release_invariants import human_review_transition, install_runtime_invariants


install_runtime_invariants()
app = legacy.app
manager = legacy.manager


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
# step on its linked ticket.  The group can be acknowledged independently; the
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


# Re-export common names explicitly and fall back to the legacy module for older
# tests/scripts that import helpers directly from ``main``.
settings = legacy.settings
lifespan = legacy.lifespan
health = legacy.health
readiness_check = legacy.readiness_check


def __getattr__(name: str):
    return getattr(legacy, name)
