import hashlib
import re
import uuid
from datetime import datetime, timezone
from typing import Optional, Union

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

import entitlements
import schemas
import security
from models import Project, SpecNode, SpecTicket, ErrorGroup, ErrorOccurrence, Workspace
from schemas import ErrorIngestPayload, ErrorIngestResponse, TicketCreate, TicketPriorityEnum, TicketStatusEnum


MAX_STORED_STACK_FRAMES = 32


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def generate_ingest_key() -> str:
    """Generate a dedicated ingest key for runtime crash telemetry."""
    return f"vb_ingest_{uuid.uuid4().hex[:24]}"


def normalize_route(route: Optional[str]) -> str:
    """Strip query/fragment data and normalize common dynamic path parameters."""
    if not route:
        return "N/A"
    cleaned = route.split("?")[0].split("#")[0].strip()
    cleaned = re.sub(
        r"/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",
        "/:id",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"/[a-f0-9]{32}", "/:id", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"/\d+", "/:id", cleaned)
    return cleaned[:256]


def redact_runtime_text(value: Optional[str], max_length: int = 4000) -> str:
    """Redact common credentials/PII before runtime telemetry is persisted."""
    if not value:
        return ""
    text = str(value)

    # URL credentials: postgres://user:password@host -> postgres://<redacted>@host
    text = re.sub(
        r"(?i)([a-z][a-z0-9+.-]*://)[^\s/:@]+:[^\s@]+@",
        r"\1<redacted>@",
        text,
    )
    # Authorization-style values and common key=value forms.
    text = re.sub(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+", "Bearer <redacted>", text)
    text = re.sub(
        r"(?i)\b(authorization|cookie|set-cookie|password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)"
        r"(\s*[:=]\s*)([^\s,;]+)",
        r"\1\2<redacted>",
        text,
    )
    text = re.sub(
        r"(?i)([?&](?:token|key|secret|password|authorization)=)[^&\s]+",
        r"\1<redacted>",
        text,
    )
    # Known secret formats.
    text = re.sub(r"\bvb_(?:live|ingest)_[A-Za-z0-9_-]{8,}\b", "<vibeus-secret>", text)
    text = re.sub(
        r"\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b",
        "<secret>",
        text,
    )
    text = re.sub(
        r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b",
        "<jwt>",
        text,
    )
    # Email addresses are not needed to identify a code crash and can be PII.
    text = re.sub(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "<email>", text)
    return text[:max_length]


def normalize_message(msg: str) -> str:
    """Normalize volatile elements from an already-redacted exception message."""
    if not msg:
        return ""
    text = re.sub(r"0x[0-9a-fA-F]+", "<addr>", msg)
    text = re.sub(r"[a-f0-9]{32,64}", "<hash>", text, flags=re.IGNORECASE)
    text = re.sub(
        r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",
        "<uuid>",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\b\d+\b", "<num>", text)
    return text.strip()[:200]


def _safe_filename(filename: str) -> str:
    value = redact_runtime_text(filename, max_length=1024).replace("\\", "/")
    parts = [part for part in value.split("/") if part]
    if not parts:
        return "unknown"
    # Keep enough context for AI navigation without persisting /home/<user>/... paths.
    return "/".join(parts[-3:])[:512]


def serialize_safe_stack(
    stack: list[Union[dict, schemas.ErrorStackFrame]],
) -> list[dict]:
    """Store only navigation metadata; source-code lines are intentionally dropped."""
    frames: list[dict] = []
    for raw in (stack or [])[:MAX_STORED_STACK_FRAMES]:
        if isinstance(raw, dict):
            data = raw
        elif hasattr(raw, "model_dump"):
            data = raw.model_dump()
        else:
            data = {
                "filename": getattr(raw, "filename", ""),
                "lineno": getattr(raw, "lineno", 0),
                "function": getattr(raw, "function", ""),
            }
        try:
            lineno = max(0, min(int(data.get("lineno") or 0), 10_000_000))
        except (TypeError, ValueError):
            lineno = 0
        frames.append(
            {
                "filename": _safe_filename(str(data.get("filename") or "unknown")),
                "lineno": lineno,
                "function": redact_runtime_text(str(data.get("function") or "unknown"), max_length=256),
            }
        )
    return frames


def extract_top_frame(stack: list[Union[dict, schemas.ErrorStackFrame]]) -> Optional[str]:
    """Identify the most relevant application code frame from the stack trace."""
    if not stack:
        return None

    frames = []
    for raw in stack:
        if isinstance(raw, dict):
            frames.append(raw)
        elif hasattr(raw, "model_dump"):
            frames.append(raw.model_dump())
        else:
            frames.append(
                {
                    "filename": getattr(raw, "filename", ""),
                    "lineno": getattr(raw, "lineno", 0),
                    "function": getattr(raw, "function", ""),
                }
            )

    for frame in reversed(frames):
        fn = str(frame.get("filename", ""))
        if fn and not any(
            ignored in fn.lower()
            for ignored in ["site-packages", "lib/python", "venv", ".venv", "fastapi", "starlette", "uvicorn", "asyncio"]
        ):
            short_fn = fn.replace("\\", "/").split("/")[-1]
            return f"{short_fn}:{frame.get('lineno', 0)} in {frame.get('function', 'unknown')}()"

    last = frames[-1]
    last_fn = str(last.get("filename", "")).replace("\\", "/").split("/")[-1]
    return f"{last_fn}:{last.get('lineno', 0)} in {last.get('function', 'unknown')}()"


def compute_fingerprint(
    service: str,
    exception_type: str,
    route: Optional[str],
    top_frame: Optional[str],
    message: str,
) -> str:
    """Compute a deterministic, privacy-preserving SHA-256 fingerprint."""
    srv = (service or "backend").strip().lower()
    exc = (exception_type or "Exception").strip()
    rt = normalize_route(route)
    tf = (top_frame or "").strip()
    norm_msg = normalize_message(message)
    raw = f"{srv}|{exc}|{rt}|{tf}|{norm_msg}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def get_or_create_error_node(db: AsyncSession, project_id: str) -> SpecNode:
    """Get the runtime section when present, otherwise use the project's active section."""
    res = await db.execute(
        select(SpecNode).where(
            SpecNode.project_id == project_id,
            SpecNode.title == "Сбои в runtime",
            SpecNode.is_deleted == False,
        )
    )
    node = res.scalar_one_or_none()
    if node:
        return node

    # Reuse an existing section to avoid duplicate-node races in projects that already
    # have a board/spec root. A runtime-only project gets a dedicated section below.
    res_any = await db.execute(
        select(SpecNode).where(SpecNode.project_id == project_id, SpecNode.is_deleted == False)
    )
    any_node = res_any.scalars().first()
    if any_node:
        return any_node

    new_node = SpecNode(
        project_id=project_id,
        title="Сбои в runtime",
        description="Автоматически созданные задачи по сбоям бэкенда и необработанным исключениям",
        content_markdown="### Мониторинг Runtime-ошибок\nЗадачи в этом разделе создаются автоматически VibeUs Runtime Bridge при падениях сервиса.",
        is_deleted=False,
    )
    db.add(new_node)
    await db.flush()
    await db.refresh(new_node)
    return new_node


def build_error_ticket_content(
    group: ErrorGroup,
    payload: ErrorIngestPayload,
    top_frame: Optional[str],
    safe_message: str,
    safe_route: str,
    safe_stack: list[dict],
) -> tuple[str, str, dict, dict]:
    """Generate AI-ready ticket content from already-sanitized runtime data."""
    location = safe_route if safe_route != "N/A" else (top_frame or group.service)
    title = f"[CRASH] {payload.exception_type} on {location}"

    stack_text = ""
    for frame in safe_stack[:12]:
        stack_text += (
            f'  File "{frame.get("filename", "unknown")}", line {frame.get("lineno", 0)}, '
            f'in {frame.get("function", "unknown")}\n'
        )
    if not stack_text:
        stack_text = "  (No call stack provided)\n"

    summary = (
        f"### 💥 Сбой в runtime ({group.service})\n\n"
        f"**Исключение:** `{payload.exception_type}: {safe_message[:300]}`\n"
        f"**Маршрут:** `{(payload.method or 'ALL').upper()} {safe_route}`\n"
        f"**Точка сбоя:** `{top_frame or 'N/A'}`\n"
        f"**Окружение:** `{redact_runtime_text(payload.environment, 32)}` | **Релиз:** `{redact_runtime_text(payload.release or 'current', 64)}`\n"
        f"**Request ID:** `{payload.request_id or 'N/A'}`\n"
        f"**Количество падений:** {group.occurrences_count}\n\n"
        f"#### 📋 Контекст для AI-разработчика\n"
        f"- Воспроизведите ошибку в тестовом сценарии перед внесением изменений.\n"
        f"- Проверьте валидацию входных данных или состояние БД в точке сбоя `{top_frame or 'обработчик'}`.\n"
        f"- Устраните первопричину и добавьте regression guard.\n\n"
        f"#### 🪵 Стек вызовов\n"
        f"```text\n{stack_text}```\n"
    )

    checklists = {
        "definition_of_done": [
            {"text": f"Воспроизвести сбой {payload.exception_type} в unit/integration тесте", "checked": False},
            {"text": f"Исправить причину в {top_frame or 'коде сервиса'}", "checked": False},
            {"text": "Проверить отсутствие регрессий через release gates", "checked": False},
        ]
    }

    bug_context = {
        "source": "runtime_error",
        "fingerprint": group.fingerprint,
        "exception_type": payload.exception_type,
        "route": safe_route,
        "method": (payload.method or "").upper() or None,
        "top_frame": top_frame,
        "occurrences": group.occurrences_count,
        "first_seen": group.first_seen_at.isoformat(),
        "last_seen": group.last_seen_at.isoformat(),
        "sample_request_id": payload.request_id,
        "stack": safe_stack,
    }
    return title, summary, checklists, bug_context


async def _append_existing_group_occurrence(
    db: AsyncSession,
    project_id: str,
    group: ErrorGroup,
    payload: ErrorIngestPayload,
    safe_route: str,
    safe_stack: list[dict],
    now: datetime,
) -> ErrorIngestResponse:
    """Record one occurrence while the ErrorGroup row is locked."""
    group.occurrences_count = int(group.occurrences_count or 0) + 1
    group.last_seen_at = now

    occurrence = ErrorOccurrence(
        group_id=group.id,
        request_id=payload.request_id,
        environment=redact_runtime_text(payload.environment, 32),
        release=redact_runtime_text(payload.release, 64) or None,
        method=(payload.method or "").upper() or None,
        route=safe_route,
        status_code=payload.status_code,
        stack=safe_stack,
        created_at=now,
    )
    db.add(occurrence)

    ticket = None
    is_regression = False
    if group.ticket_id:
        t_res = await db.execute(
            select(SpecTicket)
            .where(SpecTicket.id == group.ticket_id, SpecTicket.is_deleted == False)
            .with_for_update()
        )
        ticket = t_res.scalar_one_or_none()

    if ticket and ticket.status == "done" and group.status != "ignored":
        # A real board mutation: keep optimistic-concurrency revisions authoritative.
        p_res = await db.execute(select(Project).where(Project.id == project_id).with_for_update())
        locked_project = p_res.scalar_one()
        group.status = "open"
        ticket.status = "in_progress"
        ticket.revision = int(ticket.revision or 0) + 1
        locked_project.revision = int(locked_project.revision or 0) + 1
        is_regression = True
        ticket.rework_notes = (
            (ticket.rework_notes or "")
            + f"\n[РЕГРЕССИЯ {now.isoformat()}] Ошибка повторилась в рантайме. Всего падений: {group.occurrences_count}."
        )
        comments = list(ticket.comments or [])
        comments.append(
            {
                "id": f"c_{uuid.uuid4().hex[:8]}",
                "author": "VibeUs Watchdog",
                "text": (
                    "⚠️ Регрессия: ошибка зафиксирована снова после закрытия задачи. "
                    f"Всего падений: {group.occurrences_count}. Последний Request ID: `{payload.request_id or 'N/A'}`."
                ),
                "created_at": now.isoformat(),
            }
        )
        ticket.comments = comments
    elif group.status != "ignored":
        group.status = "open"

    await db.commit()
    await db.refresh(group)
    await db.refresh(occurrence)
    if ticket:
        await db.refresh(ticket)

    return ErrorIngestResponse(
        success=True,
        group_id=group.id,
        occurrence_id=occurrence.id,
        fingerprint=group.fingerprint,
        occurrences_count=group.occurrences_count,
        is_regression=is_regression,
        ticket_id=group.ticket_id,
        ticket_key=ticket.key if ticket else None,
    )


async def ingest_runtime_error(
    db: AsyncSession,
    project: Project,
    payload: ErrorIngestPayload,
) -> ErrorIngestResponse:
    """Ingest, group, and convert a runtime crash into at most one active ticket."""
    if not bool(getattr(project, "runtime_error_tracking_enabled", False)):
        raise HTTPException(status_code=403, detail="Runtime error tracking is disabled for this project")

    import crud

    project_id = project.id
    safe_message = redact_runtime_text(payload.message, 4000)
    safe_route = normalize_route(redact_runtime_text(payload.route, 256))
    safe_stack = serialize_safe_stack(payload.stack)
    top_frame = extract_top_frame(safe_stack)
    fingerprint = compute_fingerprint(
        service=payload.service,
        exception_type=payload.exception_type,
        route=safe_route,
        top_frame=top_frame,
        message=safe_message,
    )
    now = utcnow()

    # Serialize updates for an existing group so occurrence counters cannot lose increments.
    res = await db.execute(
        select(ErrorGroup)
        .where(ErrorGroup.project_id == project_id, ErrorGroup.fingerprint == fingerprint)
        .with_for_update()
    )
    group = res.scalar_one_or_none()
    if group:
        return await _append_existing_group_occurrence(
            db, project_id, group, payload, safe_route, safe_stack, now
        )

    # No row exists to lock. The unique constraint is the final arbiter for the
    # simultaneous-first-occurrence race. If another request wins, rollback this
    # transaction and continue against the winner instead of leaking a 500.
    group = ErrorGroup(
        project_id=project_id,
        fingerprint=fingerprint,
        service=redact_runtime_text(payload.service, 64) or "backend",
        exception_type=redact_runtime_text(payload.exception_type, 128) or "Exception",
        normalized_message=normalize_message(safe_message),
        route=safe_route,
        top_frame=top_frame,
        status="open",
        occurrences_count=1,
        first_seen_at=now,
        last_seen_at=now,
    )
    db.add(group)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        winner_res = await db.execute(
            select(ErrorGroup)
            .where(ErrorGroup.project_id == project_id, ErrorGroup.fingerprint == fingerprint)
            .with_for_update()
        )
        winner = winner_res.scalar_one_or_none()
        if winner is None:
            raise
        return await _append_existing_group_occurrence(
            db, project_id, winner, payload, safe_route, safe_stack, now
        )

    occurrence = ErrorOccurrence(
        group_id=group.id,
        request_id=payload.request_id,
        environment=redact_runtime_text(payload.environment, 32),
        release=redact_runtime_text(payload.release, 64) or None,
        method=(payload.method or "").upper() or None,
        route=safe_route,
        status_code=payload.status_code,
        stack=safe_stack,
        created_at=now,
    )
    db.add(occurrence)
    await db.flush()

    target_node = await get_or_create_error_node(db, project_id)
    title, summary, checklists, bug_context = build_error_ticket_content(
        group, payload, top_frame, safe_message, safe_route, safe_stack
    )
    ticket_data = TicketCreate(
        title=title,
        summary=summary,
        priority=TicketPriorityEnum.high if (payload.status_code or 500) >= 500 else TicketPriorityEnum.medium,
        status=TicketStatusEnum.backlog,
        source_quote=f"{payload.exception_type}: {safe_message[:200]}",
        bug_context=bug_context,
        checklists=checklists,
    )
    ticket = await crud.create_ticket(
        db=db,
        project_id=project_id,
        node_id=target_node.id,
        data=ticket_data,
        commit=False,
    )
    group.ticket_id = ticket.id

    await db.commit()
    await db.refresh(group)
    await db.refresh(occurrence)
    await db.refresh(ticket)

    # create_ticket(commit=False) deliberately suppresses integration side effects;
    # run the shared hook only after the outer transaction is durable.
    p_res = await db.execute(select(Project).where(Project.id == project_id))
    committed_project = p_res.scalar_one_or_none()
    workspace = None
    if committed_project and committed_project.workspace_id:
        w_res = await db.execute(select(Workspace).where(Workspace.id == committed_project.workspace_id))
        workspace = w_res.scalar_one_or_none()
    tier = entitlements.effective_tier(workspace) if workspace else "free"
    await crud.ticket_created_post_commit_side_effects(
        db,
        committed_project,
        ticket,
        target_node.title,
        list(committed_project.subscribers or []) if committed_project else [],
        committed_project.slug if committed_project else "",
        getattr(committed_project, "group_chat", None) if committed_project else None,
        tier,
    )

    return ErrorIngestResponse(
        success=True,
        group_id=group.id,
        occurrence_id=occurrence.id,
        fingerprint=group.fingerprint,
        occurrences_count=1,
        is_regression=False,
        ticket_id=ticket.id,
        ticket_key=ticket.key,
    )


async def rotate_ingest_key(db: AsyncSession, project: Project) -> str:
    """Rotate an ingest secret, storing only its digest. The caller owns commit/audit."""
    new_raw = generate_ingest_key()
    project.ingest_key_digest = security.hash_access_token(new_raw)
    return new_raw


async def get_project_by_ingest_key(db: AsyncSession, raw_key: str) -> Optional[Project]:
    """Look up an active project by the digest of its ingest credential."""
    if not raw_key or not raw_key.startswith("vb_ingest_"):
        return None
    digest = security.hash_access_token(raw_key.strip())
    res = await db.execute(
        select(Project).where(
            Project.ingest_key_digest == digest,
            Project.is_deleted == False,
        )
    )
    return res.scalar_one_or_none()
