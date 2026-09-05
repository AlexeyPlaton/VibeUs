from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import control_router
import models
import product_radar
from database import get_db


router = APIRouter(prefix="/api/control", tags=["control-founder-growth-strategy"])
DEFINITION_EVENT = "admin.growth_strategy.definition_saved"
PROGRESS_EVENT = "admin.growth_strategy.progress_updated"


class StrategyDefinition(BaseModel):
    key: str = Field(min_length=2, max_length=100, pattern=r"^[a-z][a-z0-9_.-]+$")
    wave: int = Field(default=0, ge=0, le=100)
    phase: str = Field(min_length=1, max_length=160)
    priority: int = Field(default=100, ge=0, le=100000)
    kind: str = Field(default="publication", min_length=1, max_length=80)
    channel: str = Field(min_length=1, max_length=200)
    market: str = Field(default="", max_length=120)
    title: str = Field(min_length=1, max_length=500)
    goal: str = Field(default="", max_length=5000)
    trigger: str = Field(default="", max_length=5000)
    planned: str = Field(default="", max_length=60000)
    format: str = Field(default="", max_length=10000)
    preflight: list[str] = Field(default_factory=list, max_length=40)
    success_signal: str = Field(default="", max_length=10000)
    destination: str = Field(default="", max_length=2048)
    rules_note: str = Field(default="", max_length=10000)

    @field_validator("phase", "kind", "channel", "market", "title", "goal", "trigger", "planned", "format", "success_signal", "destination", "rules_note")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("preflight")
    @classmethod
    def clean_preflight(cls, values: list[str]) -> list[str]:
        clean: list[str] = []
        for raw in values:
            value = str(raw or "").strip()
            if value and value not in clean:
                clean.append(value[:1000])
        return clean[:40]


class StrategyImportRequest(BaseModel):
    items: list[StrategyDefinition] = Field(min_length=1, max_length=200)
    archive_missing: bool = False

    @field_validator("items")
    @classmethod
    def unique_keys(cls, items: list[StrategyDefinition]) -> list[StrategyDefinition]:
        keys = [item.key for item in items]
        if len(keys) != len(set(keys)):
            raise ValueError("Strategy item keys must be unique")
        return items


class StrategyProgressUpdate(BaseModel):
    workflow_state: Literal["todo", "preparing", "skipped"] = "todo"
    actual: str = Field(default="", max_length=60000)
    link: str = Field(default="", max_length=2048)
    result: str = Field(default="", max_length=20000)


class StrategyArchiveRequest(BaseModel):
    reason: str = Field(default="", max_length=2000)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


async def _events(db: AsyncSession, event_type: str) -> list[models.AuditEvent]:
    return list((await db.execute(
        select(models.AuditEvent)
        .where(models.AuditEvent.event_type == event_type)
        .order_by(models.AuditEvent.created_at.asc(), models.AuditEvent.id.asc())
    )).scalars().all())


async def _latest_definitions(db: AsyncSession, *, include_archived: bool = False) -> dict[str, dict[str, Any]]:
    state: dict[str, dict[str, Any]] = {}
    for event in await _events(db, DEFINITION_EVENT):
        details = dict(event.details or {})
        key = str(details.get("key") or "").strip()
        definition = details.get("definition")
        if not key or not isinstance(definition, dict):
            continue
        record = dict(definition)
        record["key"] = key
        record["archived"] = bool(details.get("archived"))
        record["definition_updated_at"] = _iso(event.created_at)
        state[key] = record
    if include_archived:
        return state
    return {key: value for key, value in state.items() if not value.get("archived")}


async def _latest_progress(db: AsyncSession) -> dict[str, dict[str, Any]]:
    state: dict[str, dict[str, Any]] = {}
    for event in await _events(db, PROGRESS_EVENT):
        details = dict(event.details or {})
        key = str(details.get("key") or "").strip()
        if not key:
            continue
        details["progress_updated_at"] = _iso(event.created_at)
        state[key] = details
    return state


def _derive_status(progress: dict[str, Any]) -> str:
    if str(progress.get("actual") or "").strip():
        return "done"
    state = str(progress.get("workflow_state") or "todo")
    return state if state in {"todo", "preparing", "skipped"} else "todo"


def merge_strategy_item(definition: dict[str, Any], progress: dict[str, Any] | None = None) -> dict[str, Any]:
    progress = dict(progress or {})
    item = dict(definition)
    workflow_state = str(progress.get("workflow_state") or "todo")
    if workflow_state not in {"todo", "preparing", "skipped"}:
        workflow_state = "todo"
    item.update({
        "workflow_state": workflow_state,
        "status": _derive_status(progress),
        "actual": str(progress.get("actual") or ""),
        "link": str(progress.get("link") or ""),
        "result": str(progress.get("result") or ""),
        "completed_at": progress.get("completed_at"),
        "progress_updated_at": progress.get("progress_updated_at"),
    })
    return item


async def _strategy_items(db: AsyncSession) -> list[dict[str, Any]]:
    definitions = await _latest_definitions(db)
    progress = await _latest_progress(db)
    items = [merge_strategy_item(definition, progress.get(key)) for key, definition in definitions.items()]
    return sorted(items, key=lambda item: (int(item.get("wave") or 0), int(item.get("priority") or 0), str(item.get("key") or "")))


def _counts(items: list[dict[str, Any]]) -> dict[str, int]:
    return {status: sum(1 for item in items if item.get("status") == status) for status in ("todo", "preparing", "done", "skipped")}


def _next_items(items: list[dict[str, Any]], limit: int = 5) -> list[dict[str, Any]]:
    return [item for item in items if item.get("status") not in {"done", "skipped"}][:limit]


async def _strategy_payload(db: AsyncSession, admin: models.User) -> dict[str, Any]:
    items = await _strategy_items(db)
    radar = await product_radar.product_radar(user=admin, db=db)
    return {
        "generated_at": _iso(models.utcnow()),
        "items": items,
        "counts": _counts(items),
        "total": len(items),
        "needs_import": not items,
        "next": _next_items(items),
        "radar": {
            "north_star": radar.get("north_star", {}),
            "dimensions": radar.get("dimensions", []),
            "steering_queue": radar.get("steering_queue", []),
            "guardrails": radar.get("guardrails", []),
            "data_coverage": radar.get("data_coverage", {}),
        },
        "privacy": {
            "platform_admin_only": True,
            "definitions_bundled_in_public_source": False,
            "system_customer_free_form_content_included": False,
            "system_customer_emails_included": False,
            "system_secrets_included": False,
            "founder_fields_included_verbatim": ["planned", "actual", "result"],
        },
    }


@router.get("/growth-strategy")
async def get_growth_strategy(
    admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    return await _strategy_payload(db, admin)


@router.post("/growth-strategy/import")
async def import_growth_strategy(
    payload: StrategyImportRequest,
    admin: models.User = Depends(control_router.require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    previous = await _latest_definitions(db, include_archived=True)
    imported_keys = {item.key for item in payload.items}
    now = models.utcnow()

    for item in payload.items:
        db.add(models.AuditEvent(
            user_id=admin.id,
            event_type=DEFINITION_EVENT,
            details={
                "key": item.key,
                "definition": item.model_dump(mode="json"),
                "archived": False,
                "source": "founder_private_import",
            },
        ))

    archived = 0
    if payload.archive_missing:
        for key, old in previous.items():
            if key in imported_keys or old.get("archived"):
                continue
            definition = {field: value for field, value in old.items() if field not in {"archived", "definition_updated_at"}}
            db.add(models.AuditEvent(
                user_id=admin.id,
                event_type=DEFINITION_EVENT,
                details={
                    "key": key,
                    "definition": definition,
                    "archived": True,
                    "source": "founder_private_import",
                },
            ))
            archived += 1

    db.add(models.AuditEvent(
        user_id=admin.id,
        event_type="admin.growth_strategy.imported",
        details={
            "items": len(payload.items),
            "archive_missing": payload.archive_missing,
            "archived": archived,
            "imported_at": _iso(now),
        },
    ))
    await db.commit()
    items = await _strategy_items(db)
    return {"items": items, "counts": _counts(items), "total": len(items), "archived": archived}


@router.patch("/growth-strategy/{key}/progress")
async def update_growth_strategy_progress(
    key: str,
    payload: StrategyProgressUpdate,
    admin: models.User = Depends(control_router.require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    definitions = await _latest_definitions(db)
    definition = definitions.get(key)
    if not definition:
        raise HTTPException(status_code=404, detail="Growth strategy item not found")

    previous = (await _latest_progress(db)).get(key, {})
    actual = payload.actual.strip()
    completed_at = previous.get("completed_at")
    if actual and not str(previous.get("actual") or "").strip():
        completed_at = _iso(models.utcnow())
    if not actual:
        completed_at = None

    details = {
        "key": key,
        "workflow_state": payload.workflow_state,
        "actual": actual,
        "link": payload.link.strip(),
        "result": payload.result.strip(),
        "completed_at": completed_at,
    }
    event = models.AuditEvent(
        user_id=admin.id,
        event_type=PROGRESS_EVENT,
        details=details,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    details["progress_updated_at"] = _iso(event.created_at)
    return merge_strategy_item(definition, details)


@router.post("/growth-strategy/{key}/archive")
async def archive_growth_strategy_item(
    key: str,
    payload: StrategyArchiveRequest,
    admin: models.User = Depends(control_router.require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    definitions = await _latest_definitions(db)
    definition = definitions.get(key)
    if not definition:
        raise HTTPException(status_code=404, detail="Growth strategy item not found")
    clean_definition = {field: value for field, value in definition.items() if field not in {"archived", "definition_updated_at"}}
    db.add(models.AuditEvent(
        user_id=admin.id,
        event_type=DEFINITION_EVENT,
        details={
            "key": key,
            "definition": clean_definition,
            "archived": True,
            "source": "founder_manual_archive",
            "reason": payload.reason.strip(),
        },
    ))
    await db.commit()
    return {"key": key, "archived": True}


@router.get("/growth-strategy/export")
async def export_growth_strategy(
    _admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    items = await _strategy_items(db)
    definitions = []
    progress = []
    definition_fields = set(StrategyDefinition.model_fields)
    for item in items:
        definitions.append({field: item.get(field) for field in definition_fields})
        progress.append({
            "key": item.get("key"),
            "workflow_state": item.get("workflow_state"),
            "actual": item.get("actual"),
            "link": item.get("link"),
            "result": item.get("result"),
            "completed_at": item.get("completed_at"),
        })
    return {
        "exported_at": _iso(models.utcnow()),
        "definitions": {"items": definitions, "archive_missing": False},
        "progress": progress,
    }


def _md(value: Any) -> str:
    if value is None:
        return "—"
    return str(value).replace("|", "\\|").replace("\r", " ").strip()


def render_strategy_markdown(payload: dict[str, Any]) -> str:
    counts = payload.get("counts", {})
    total = int(payload.get("total") or 0)
    done = int(counts.get("done") or 0)
    radar = payload.get("radar", {})
    north_star = radar.get("north_star", {})

    lines = [
        "# VibeUs Founder Strategy + Product Radar",
        "",
        f"Generated: `{_md(payload.get('generated_at'))}`",
        "",
        "> Private platform-admin context. Strategy definitions are not bundled in the public repository. Founder-entered planned/actual/result text is included verbatim, so do not paste credentials or unnecessary personal data if this Markdown will be shared with an external AI.",
        "",
        "## Instructions for an AI strategist",
        "",
        "- Read the saved strategy before proposing new distribution work; do not recommend repeating an item that already has actual completion evidence.",
        "- Treat founder-entered `actual` as the ground truth about what was really published/done; `planned` is only the strategy brief.",
        "- Protect P0 money, fiscal, legal, security and reliability guardrails before recommending acquisition scale.",
        "- Prefer activation, first value and repeat value over raw signup, impression, vote or follower growth.",
        "- Respect each saved channel caution. If third-party rules may have changed, request a fresh rules check before publication.",
        "- Prefer the next unfinished saved strategy item unless live Product Radar evidence gives a concrete reason to change the order.",
        "",
        "## Current Product Radar",
        "",
        f"**North Star — {_md(north_star.get('name', 'Weekly Value Workspaces'))}: {_md(north_star.get('value'))}**",
        f"Previous: {_md(north_star.get('previous'))}; change: {_md(north_star.get('change_pct'))}%; confidence: {_md(north_star.get('confidence'))}.",
        "",
        "| Dimension | Status | Value | Unit | Score | Confidence | Sample | Trend | Target |",
        "|---|---|---:|---|---:|---|---:|---:|---|",
    ]
    for item in radar.get("dimensions", []):
        lines.append(
            f"| {_md(item.get('label'))} | {_md(item.get('status'))} | {_md(item.get('value'))} | {_md(item.get('unit'))} | {_md(item.get('score'))} | {_md(item.get('confidence'))} | {_md(item.get('sample'))} | {_md(item.get('trend_pct'))} | {_md(item.get('target'))} |"
        )

    lines += ["", "### Steering Queue", ""]
    steering = radar.get("steering_queue", [])
    if steering:
        for item in steering:
            lines.append(
                f"- **{_md(item.get('priority'))} · {_md(item.get('area'))}: {_md(item.get('title'))}** — {_md(item.get('reason'))} Action: {_md(item.get('action'))} Guardrail: {_md(item.get('guardrail'))}"
            )
    else:
        lines.append("- No steering intervention generated from current radar signals.")

    lines += [
        "",
        "## Saved founder strategy",
        "",
        f"Completed: **{done}/{total}** · preparing: **{int(counts.get('preparing') or 0)}** · skipped: **{int(counts.get('skipped') or 0)}**.",
        "",
    ]

    items = payload.get("items", [])
    if not items:
        lines += [
            "No private strategy pack has been imported yet.",
            "",
            "Import the founder strategy in `/control/strategy`; the next Markdown request will include it automatically.",
            "",
        ]
    else:
        grouped: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
        for item in items:
            grouped[(int(item.get("wave") or 0), str(item.get("phase") or ""))].append(item)

        for (wave, phase), group_items in sorted(grouped.items(), key=lambda pair: pair[0][0]):
            lines += [f"### Wave {wave} — {_md(phase)}", ""]
            for item in group_items:
                checkbox = "x" if item.get("status") == "done" else " "
                lines.append(f"- [{checkbox}] **{_md(item.get('title'))}** — {_md(item.get('channel'))} · {_md(item.get('market'))} · status `{_md(item.get('status'))}`")
                lines.append(f"  - Goal: {_md(item.get('goal'))}")
                lines.append(f"  - Trigger: {_md(item.get('trigger'))}")
                lines.append(f"  - Planned brief: {_md(item.get('planned'))}")
                lines.append(f"  - Format: {_md(item.get('format'))}")
                lines.append(f"  - Success signal: {_md(item.get('success_signal'))}")
                if item.get("rules_note"):
                    lines.append(f"  - Rules / caution: {_md(item.get('rules_note'))}")
                if item.get("preflight"):
                    lines.append("  - Preflight: " + "; ".join(_md(value) for value in item.get("preflight", [])))
                actual = str(item.get("actual") or "").strip()
                if actual:
                    lines.append("  - **Actual completion evidence / published content:**")
                    for paragraph in actual.splitlines() or [actual]:
                        lines.append(f"    > {_md(paragraph)}")
                if item.get("link"):
                    lines.append(f"  - Published/artifact URL: {_md(item.get('link'))}")
                if item.get("completed_at"):
                    lines.append(f"  - Completed at: {_md(item.get('completed_at'))}")
                if item.get("result"):
                    lines.append(f"  - Result / learning: {_md(item.get('result'))}")
                lines.append("")

    lines += ["## Next saved strategy items", ""]
    next_items = payload.get("next", [])
    if next_items:
        for item in next_items:
            lines.append(f"- Wave {item.get('wave')} · **{_md(item.get('title'))}** — {_md(item.get('channel'))}. Trigger: {_md(item.get('trigger'))}")
    else:
        lines.append("- No unfinished saved strategy item. Import/revise the private strategy from current evidence instead of inventing distribution work from vanity metrics.")

    lines += [
        "",
        "## Suggested AI response contract",
        "",
        "1. Diagnose whether the saved strategy order still matches Product Radar evidence.",
        "2. Name the next 1–3 unfinished items and explain why they should happen now.",
        "3. Tell the founder what NOT to publish or scale yet.",
        "4. Improve the next planned brief if useful, without overwriting founder-entered actual evidence.",
        "5. State the metric or observation to review after each action.",
        "6. Identify any missing data or third-party rules check that makes the recommendation uncertain.",
        "",
    ]
    return "\n".join(lines)


@router.get("/growth-strategy.md")
@router.get("/strategy.md")
async def growth_strategy_markdown(
    admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    payload = await _strategy_payload(db, admin)
    return Response(
        content=render_strategy_markdown(payload),
        media_type="text/markdown; charset=utf-8",
        headers={"Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow"},
    )
