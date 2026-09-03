"""Release-critical invariants shared by every transport.

This module deliberately sits below REST/MCP/WebSocket handlers. The public API
has several mutation transports, so security/business invariants must not depend
on one route remembering to repeat a check.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import event, func, select

import crud
import entitlements
import models
from criteria_evidence import criteria_auto_review_ready
from settings import get_settings


_INSTALLED = False
_HUMAN_REVIEW_TRANSITION: ContextVar[bool] = ContextVar(
    "vibeus_human_review_transition", default=False
)


@contextmanager
def human_review_transition():
    """Permit the authenticated human-review endpoint to enter ``done``."""
    token = _HUMAN_REVIEW_TRANSITION.set(True)
    try:
        yield
    finally:
        _HUMAN_REVIEW_TRANSITION.reset(token)


def _normalized_status(value) -> Optional[str]:
    if value is None:
        return None
    return str(getattr(value, "value", value)).strip().lower()


def done_transition_requires_human_context(value) -> bool:
    """Pure policy helper used by both the ORM guard and regression tests."""
    return _normalized_status(value) == "done" and not _HUMAN_REVIEW_TRANSITION.get()


def _orm_guard_enabled() -> bool:
    # Native tests legitimately create historical fixtures already in ``done``.
    # Transport-level guards remain active in tests, while the extra ORM backstop
    # is enabled in every production-like runtime where requests are untrusted.
    return get_settings().environment in {"staging", "production", "quality_gate"}


def _install_done_guard() -> None:
    @event.listens_for(models.SpecTicket.status, "set", retval=True, active_history=True)
    def _protect_done(target, value, oldvalue, initiator):  # noqa: ARG001
        if _orm_guard_enabled() and done_transition_requires_human_context(value):
            raise HTTPException(
                status_code=403,
                detail="Final acceptance is a human review action; use the review endpoint",
            )
        return value


def _canonical_commercial_tier(value: str) -> str:
    """Normalize historical paid tier names without changing stored contracts."""
    normalized = str(value or "free").strip().lower()
    return {"pro": "solo", "team": "studio"}.get(normalized, normalized)


def _install_project_limit_guard() -> None:
    original = crud.create_project

    async def create_project_with_hard_limit(db, data, api_token=None, workspace=None):
        workspace_id = getattr(workspace, "id", None) or getattr(data, "workspace_id", None)
        if not workspace_id:
            raise HTTPException(status_code=422, detail="workspace_id is required")

        locked_result = await db.execute(
            select(models.Workspace)
            .where(models.Workspace.id == workspace_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        locked_workspace = locked_result.scalar_one_or_none()
        if not locked_workspace:
            raise HTTPException(status_code=404, detail="Workspace not found")

        count_result = await db.execute(
            select(func.count(models.Project.id)).where(
                models.Project.workspace_id == locked_workspace.id,
                models.Project.is_deleted == False,
            )
        )
        project_count = int(count_result.scalar() or 0)
        tier = _canonical_commercial_tier(entitlements.effective_tier(locked_workspace))
        limit = {"free": 1, "solo": 10, "studio": 50, "business": 1_000_000}.get(tier, 1)
        if project_count >= limit:
            raise HTTPException(
                status_code=402,
                detail=f"Project limit for {tier.title()} is exhausted ({limit})",
            )

        return await original(
            db,
            data,
            api_token=api_token,
            workspace=locked_workspace,
        )

    crud.create_project = create_project_with_hard_limit


def _install_ticket_transition_guard() -> None:
    original = crud.update_ticket

    async def update_ticket_with_transition_policy(db, project_id, ticket_id, data, if_match=None):
        requested_status = _normalized_status(getattr(data, "status", None))
        if requested_status == "done":
            raise HTTPException(
                status_code=403,
                detail="Final acceptance is a human review action; use the review endpoint",
            )
        if requested_status == "review":
            result = await db.execute(
                select(models.SpecTicket)
                .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
                .where(
                    models.SpecTicket.id == ticket_id,
                    models.SpecNode.project_id == project_id,
                    models.SpecTicket.is_deleted == False,
                )
            )
            ticket = result.scalar_one_or_none()
            if ticket:
                ready, missing = criteria_auto_review_ready(ticket)
                if not ready:
                    raise HTTPException(
                        status_code=409,
                        detail={"code": "criteria_unverified", "missing_criteria": missing[:50]},
                    )

        return await original(db, project_id, ticket_id, data, if_match=if_match)

    crud.update_ticket = update_ticket_with_transition_policy


def install_runtime_invariants() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    _install_done_guard()
    _install_project_limit_guard()
    _install_ticket_transition_guard()
    _INSTALLED = True
