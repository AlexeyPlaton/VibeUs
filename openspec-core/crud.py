import schemas
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified
from typing import List, Optional
from fastapi import HTTPException
import uuid
from datetime import datetime, timezone, timedelta

import models
import security
from models import Workspace, Project, SpecNode, SpecTicket, ProjectAccessLink, AuditEvent, PromoCode, PromoRedemption, Feedback, ErrorGroup, ErrorOccurrence
from security import hash_access_token
from schemas import ProjectCreate, NodeCreate, TicketCreate, TicketUpdate
import telegram_service
import github_service
import entitlements

# === WORKSPACES ===

async def get_or_create_workspace(
    db: AsyncSession, 
    workspace_id: Optional[str] = None, 
    owner_email: Optional[str] = None,
    name: Optional[str] = None
) -> Workspace:
    if workspace_id:
        res = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
        ws = res.scalar_one_or_none()
        if ws:
            return ws

    email = owner_email or "developer@vibeus.pro"
    res = await db.execute(select(Workspace).where(Workspace.owner_email == email).order_by(Workspace.created_at.asc()))
    matches = list(res.scalars().all())
    if len(matches) > 1:
        raise HTTPException(
            status_code=409,
            detail="Multiple workspaces match owner_email; pass workspace_id explicitly",
        )
    ws = matches[0] if matches else None
    if not ws:
        raw_key = f"ws_live_{uuid.uuid4().hex[:24]}"
        ws = Workspace(
            name=name or f"Workspace ({email.split('@')[0]})",
            owner_email=email,
            api_key_digest=hash_access_token(raw_key),
            subscription_tier="free",
            tickets_used_this_month=0
        )
        db.add(ws)
        await db.commit()
        await db.refresh(ws)
    return ws

def normalize_tier(tier: Optional[str]) -> str:
    t = (tier or "").strip().lower()
    if t == "pro":
        return "solo"
    if t in ("team", "enterprise"):
        return "studio"
    return t

def has_telegram_entitlement(tier: Optional[str], proj_slug: Optional[str] = None) -> bool:
    if proj_slug == "demo-showcase":
        return True
    return normalize_tier(tier) in {"solo", "studio", "business"}

async def get_workspace_by_id(db: AsyncSession, workspace_id: str) -> Optional[Workspace]:
    res = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    return res.scalar_one_or_none()

async def update_workspace_tier(db: AsyncSession, workspace_id: str, tier: str) -> Optional[Workspace]:
    ws = await get_workspace_by_id(db, workspace_id)
    if not ws:
        return None
    ws.subscription_tier = normalize_tier(tier)
    await db.commit()
    await db.refresh(ws)
    return ws

async def redeem_promo_code(
    db: AsyncSession,
    workspace_id: str,
    code: str,
    user_id: Optional[str] = None,
) -> tuple[Workspace, PromoCode]:
    ws = await get_workspace_by_id(db, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    clean_code = (code or "").strip().upper()
    code_digest = security.hash_access_token(clean_code)

    result = await db.execute(
        select(models.PromoCode).where(
            models.PromoCode.code_digest == code_digest,
            models.PromoCode.is_active == True,
        ).with_for_update()
    )
    promo = result.scalar_one_or_none()
    if not promo:
        raise HTTPException(status_code=400, detail="Неверный или устаревший промокод")

    now = models.utcnow()
    if promo.expires_at and promo.expires_at < now:
        raise HTTPException(status_code=400, detail="Срок действия промокода истек")
    if promo.times_used >= promo.max_uses:
        raise HTTPException(status_code=400, detail="Промокод уже исчерпан")

    reuse_conditions = [PromoRedemption.workspace_id == workspace_id]
    if user_id:
        reuse_conditions.append(PromoRedemption.user_id == user_id)
    prior = await db.execute(
        select(PromoRedemption).where(
            PromoRedemption.promo_code_id == promo.id,
            or_(*reuse_conditions),
        )
    )
    if prior.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Этот промокод уже активирован этим пользователем или workspace")

    promo_tier = normalize_tier(promo.tier)
    if promo_tier not in {"solo", "studio", "business"}:
        raise HTTPException(status_code=500, detail="Промокод настроен на неподдерживаемый тариф")

    rank = {"free": 0, "solo": 1, "studio": 2, "business": 3}
    current_tier = normalize_tier(entitlements.effective_tier(ws))
    if rank.get(current_tier, 0) > rank.get(promo_tier, 0):
        raise HTTPException(
            status_code=409,
            detail=f"Промокод {promo_tier.title()} нельзя применить поверх активного более высокого тарифа {current_tier.title()}.",
        )

    target_tier = promo_tier

    if promo.grants_lifetime:
        ws.subscription_tier = target_tier
        ws.subscription_status = "active"
        ws.is_lifetime_free = True
        ws.current_period_start = ws.current_period_start or now
        ws.current_period_end = None
        ws.cancel_at_period_end = False
        duration_days = None
    else:
        duration_days = int(promo.duration_days or 30)
        if duration_days < 1 or duration_days > 3660:
            raise HTTPException(status_code=500, detail="Промокод имеет некорректный срок доступа")
        base = ws.current_period_end if ws.current_period_end and ws.current_period_end > now else now
        ws.subscription_tier = target_tier
        ws.subscription_status = "active"
        ws.is_lifetime_free = False
        ws.current_period_start = now if base == now else (ws.current_period_start or now)
        ws.current_period_end = base + timedelta(days=duration_days)
        ws.cancel_at_period_end = False

    # Keep the real payment provider untouched. Promo provenance is recorded in
    # promo_code_used / PromoRedemption / AuditEvent.
    ws.promo_code_used = code_digest
    promo.times_used += 1
    db.add(PromoRedemption(
        promo_code_id=promo.id,
        workspace_id=workspace_id,
        user_id=user_id,
        campaign=promo.campaign,
        tier=promo_tier,
        duration_days=duration_days,
    ))
    db.add(AuditEvent(
        workspace_id=workspace_id,
        user_id=user_id,
        event_type="billing.promo.redeemed",
        details={
            "campaign": promo.campaign,
            "tier": promo_tier,
            "duration_days": duration_days,
            "grants_lifetime": bool(promo.grants_lifetime),
        },
    ))
    await db.commit()
    await db.refresh(ws)
    return ws, promo

# === PROJECTS ===

async def get_project_by_slug(db: AsyncSession, slug: str) -> Optional[Project]:
    result = await db.execute(select(Project).where(Project.slug == slug, Project.is_deleted == False))
    return result.scalar_one_or_none()

async def get_project_by_id(db: AsyncSession, project_id: str) -> Optional[Project]:
    result = await db.execute(select(Project).where(Project.id == project_id, Project.is_deleted == False))
    return result.scalar_one_or_none()

async def get_or_create_project_by_slug(db: AsyncSession, slug: str, name: Optional[str] = None) -> Project:
    project = await get_project_by_slug(db, slug)
    if project:
        return project
    
    workspace = await get_or_create_workspace(db, owner_email="dev@vibeus.pro", name="Developer Workspace")
    raw_token = f"vb_live_{uuid.uuid4().hex[:24]}"
    token_digest = hash_access_token(raw_token)
    project = Project(
        name=name or slug.replace('_', ' ').replace('-', ' ').title(),
        slug=slug,
        workspace_id=workspace.id,
        api_token_digest=token_digest
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    
    node = SpecNode(
        project_id=project.id,
        title="Общие задачи и спецификация",
        description="Раздел задач проекта",
        content_markdown="### Спецификация проекта\nСпецификация и задачи проекта синхронизируются в реальном времени.",
        is_deleted=False
    )
    db.add(node)
    await db.commit()
    return project

async def get_project_by_token(db: AsyncSession, token: str) -> Optional[Project]:
    digest = hash_access_token(token)
    result = await db.execute(select(Project).where(Project.api_token_digest == digest, Project.is_deleted == False))
    return result.scalar_one_or_none()

async def create_project(
    db: AsyncSession,
    data: ProjectCreate,
    api_token: Optional[str] = None,
    workspace: Optional[Workspace] = None,
) -> tuple[Project, str, str, str]:
    # Project ownership must be explicit. Never resolve tenancy by a non-unique
    # owner_email lookup. The API layer validates membership/capabilities first.
    if workspace is None:
        if not data.workspace_id:
            raise HTTPException(status_code=422, detail="workspace_id is required")
        workspace = await get_workspace_by_id(db, data.workspace_id)
        if not workspace:
            raise HTTPException(status_code=404, detail="Workspace not found")

    # 🛡️ Paywall: Check project limits based on subscription tier with DB lock
    w_res = await db.execute(
        select(Workspace)
        .where(Workspace.id == workspace.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    workspace = w_res.scalar_one_or_none() or workspace

    project_count_res = await db.execute(
        select(func.count(Project.id)).where(Project.workspace_id == workspace.id, Project.is_deleted == False)
    )
    project_count = project_count_res.scalar() or 0

    tier = normalize_tier(entitlements.effective_tier(workspace))
    if not getattr(workspace, 'is_lifetime_free', False):
        if tier == 'free' and project_count >= 1:
            raise HTTPException(
                status_code=402, 
                detail="Лимит тарифа Free исчерпан (максимум 1 проект). Обновитесь до Solo для работы с 10 проектами."
            )
        elif tier == 'solo' and project_count >= 10:
            raise HTTPException(
                status_code=402, 
                detail="Лимит тарифа Solo исчерпан (максимум 10 проектов). Обновитесь до Studio (максимум 50 проектов)."
            )
        elif tier == 'studio' and project_count >= 50:
            raise HTTPException(
                status_code=402,
                detail="Лимит тарифа Studio исчерпан (максимум 50 проектов)."
            )

    raw_token = api_token or f"vb_live_{uuid.uuid4().hex[:24]}"
    token_digest = hash_access_token(raw_token)
    raw_public_key = f"vb_pub_{uuid.uuid4().hex[:24]}"
    public_key_digest = hash_access_token(raw_public_key)
    raw_ingest_key = f"vb_ingest_{uuid.uuid4().hex[:24]}"
    ingest_key_digest = hash_access_token(raw_ingest_key)

    project = Project(
        workspace_id=workspace.id,
        name=data.name,
        slug=data.slug,
        description=data.description,
        api_token_digest=token_digest,
        public_widget_key=raw_public_key,
        public_widget_key_digest=public_key_digest,
        public_widget_origins=getattr(data, "public_widget_origins", []) or [],
        ingest_key_digest=ingest_key_digest,
        runtime_error_tracking_enabled=False,
        columns=[
            {"id": "backlog", "label": "Бэклог", "color": "slate"},
            {"id": "in_progress", "label": "В работе", "color": "amber"},
            {"id": "review", "label": "Приемка / QA", "color": "indigo"},
            {"id": "done", "label": "Готово", "color": "emerald"}
        ],
        subscribers=[],
        feedbacks=[],
        is_deleted=False
    )
    db.add(project)
    db.add(AuditEvent(project_id=project.id, workspace_id=workspace.id, event_type="project.created", details={"slug": project.slug}))
    await db.commit()
    await db.refresh(project)
    return project, raw_token, raw_public_key, raw_ingest_key

async def update_project(db: AsyncSession, project_id: str, data: dict) -> Optional[Project]:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        return None
    for key, value in data.items():
        if hasattr(project, key):
            setattr(project, key, value)
    await db.commit()
    await db.refresh(project)
    return project

async def delete_project(db: AsyncSession, project_id: str) -> bool:
    """Soft-delete project data while immediately revoking every reusable credential.

    Physical purge is a separate retention operation because payment/audit records may
    have independent legal retention requirements. This tombstone must nevertheless
    make the deleted project unusable immediately and remove stored integration secrets.
    """
    result = await db.execute(select(Project).where(Project.id == project_id).with_for_update())
    project = result.scalar_one_or_none()
    if not project:
        return False

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    original_slug = project.slug

    project.is_deleted = True
    project.slug = f"{original_slug}__deleted__{uuid.uuid4().hex[:8]}"

    # Revoke or remove every reusable credential kept on the project row. Public
    # widget keys are not confidential, but clearing them prevents accidental reuse.
    project.api_token_digest = None
    project.public_widget_key = None
    project.public_widget_key_digest = None
    project.ingest_key_digest = None
    project.github_token_encrypted = None
    project.github_sync_enabled = False
    project.runtime_error_tracking_enabled = False
    project.telemetry_enabled = False
    project.ai_data_sharing = False

    # Access-link tokens are non-nullable, so replace their hashes with unique
    # tombstones and expire them instead of leaving still-verifiable credentials.
    access_res = await db.execute(
        select(ProjectAccessLink).where(ProjectAccessLink.project_id == project_id).with_for_update()
    )
    access_links = list(access_res.scalars().all())
    access_link_ids = [link.id for link in access_links]
    for link in access_links:
        link.token_hash = f"revoked_{uuid.uuid4().hex}"
        link.expires_at = now
        link.activated_fingerprint = None

    # Tunnel connector credentials and preview sessions are independent rows and
    # must be revoked explicitly because their FKs do not cascade on soft-delete.
    tunnel_res = await db.execute(
        select(models.TunnelSession).where(models.TunnelSession.project_id == project_id).with_for_update()
    )
    tunnels = list(tunnel_res.scalars().all())
    tunnel_ids = [tunnel.tunnel_id for tunnel in tunnels]
    for tunnel in tunnels:
        tunnel.status = "revoked"
        tunnel.is_connected = False
        tunnel.connect_token_digest = f"revoked_{uuid.uuid4().hex}"
        tunnel.expires_at = now

    preview_filters = []
    if tunnel_ids:
        preview_filters.append(models.PreviewSession.tunnel_id.in_(tunnel_ids))
    if access_link_ids:
        preview_filters.append(models.PreviewSession.access_link_id.in_(access_link_ids))
    if preview_filters:
        from sqlalchemy import or_
        preview_res = await db.execute(
            select(models.PreviewSession).where(or_(*preview_filters)).with_for_update()
        )
        for preview in preview_res.scalars().all():
            preview.revoked_at = preview.revoked_at or now

    nodes = await get_nodes_by_project(db, project_id)
    for node in nodes:
        node.is_deleted = True
        tickets = await get_tickets_by_node(db, node.id)
        for ticket in tickets:
            ticket.is_deleted = True

    db.add(AuditEvent(
        project_id=project_id,
        workspace_id=project.workspace_id,
        event_type="project.deleted",
        details={"slug": original_slug, "credentials_revoked": True},
    ))
    await db.commit()
    return True

# === NODES ===

async def get_nodes_by_project(db: AsyncSession, project_id: str) -> List[SpecNode]:
    result = await db.execute(
        select(SpecNode)
        .where(SpecNode.project_id == project_id, SpecNode.is_deleted == False)
        .options(selectinload(SpecNode.tickets))
    )
    return result.scalars().all()

async def create_node(db: AsyncSession, project_id: str, data: NodeCreate) -> SpecNode:
    if data.parent_id:
        p_res = await db.execute(select(SpecNode).where(SpecNode.id == data.parent_id, SpecNode.project_id == project_id, SpecNode.is_deleted == False))
        if not p_res.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Parent node not found in this project")

    node = SpecNode(
        project_id=project_id,
        parent_id=data.parent_id,
        title=data.title,
        description=data.description,
        content_markdown=data.content_markdown,
        discussions=data.discussions,
        is_deleted=False
    )
    db.add(node)
    p_res = await db.execute(select(Project).where(Project.id == project_id))
    project = p_res.scalar_one_or_none()
    if project:
        project.revision = (project.revision or 0) + 1
    await db.commit()
    await db.refresh(node)
    return node

async def update_node(db: AsyncSession, project_id: str, node_id: str, data: dict) -> Optional[SpecNode]:
    result = await db.execute(select(SpecNode).where(SpecNode.id == node_id, SpecNode.project_id == project_id, SpecNode.is_deleted == False))
    node = result.scalar_one_or_none()
    if not node:
        return None
    for key, value in data.items():
        if hasattr(node, key):
            setattr(node, key, value)
    p_res = await db.execute(select(Project).where(Project.id == project_id))
    project = p_res.scalar_one_or_none()
    if project:
        project.revision = (project.revision or 0) + 1
    await db.commit()
    await db.refresh(node)
    return node

async def delete_node(db: AsyncSession, project_id: str, node_id: str) -> bool:
    result = await db.execute(select(SpecNode).where(SpecNode.id == node_id, SpecNode.project_id == project_id, SpecNode.is_deleted == False))
    node = result.scalar_one_or_none()
    if not node:
        return False
    node.is_deleted = True
    tickets = await get_tickets_by_node(db, node_id)
    for ticket in tickets:
        ticket.is_deleted = True
    p_res = await db.execute(select(Project).where(Project.id == project_id))
    project = p_res.scalar_one_or_none()
    if project:
        project.revision = (project.revision or 0) + 1
    await db.commit()
    return True

# === TICKETS ===

async def get_tickets_by_node(db: AsyncSession, node_id: str) -> List[SpecTicket]:
    result = await db.execute(select(SpecTicket).where(SpecTicket.node_id == node_id, SpecTicket.is_deleted == False))
    return result.scalars().all()

_async_project_locks: dict[str, asyncio.Lock] = {}

async def create_ticket(db: AsyncSession, project_id: str, node_id: str, data: TicketCreate, commit: bool = True) -> SpecTicket:
    result = await db.execute(select(SpecNode).where(SpecNode.id == node_id, SpecNode.project_id == project_id, SpecNode.is_deleted == False))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found in this project")
    
    if project_id not in _async_project_locks:
        _async_project_locks[project_id] = asyncio.Lock()

    async with _async_project_locks[project_id]:
        p_res = await db.execute(
            select(Project)
            .where(Project.id == project_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        project = p_res.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        project.ticket_seq = (project.ticket_seq or 0) + 1
        seq_num = project.ticket_seq

        workspace = None
        if project.workspace_id:
            w_res = await db.execute(
                select(Workspace)
                .where(Workspace.id == project.workspace_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            workspace = w_res.scalar_one_or_none()

        # 🛡️ Paywall: Monthly ticket quota check for Free tier (30 tickets/mo) with period boundary
        is_lifetime = getattr(workspace, 'is_lifetime_free', False) if workspace else False
        if workspace and entitlements.effective_tier(workspace) == 'free' and not is_lifetime:
            now = datetime.now(timezone.utc)
            period_start = getattr(workspace, 'tickets_usage_period_start', None) or workspace.created_at or now
            if period_start and (now.year != period_start.year or now.month != period_start.month):
                workspace.tickets_used_this_month = 0
                workspace.tickets_usage_period_start = now
            elif not workspace.tickets_usage_period_start:
                workspace.tickets_usage_period_start = period_start

            if (workspace.tickets_used_this_month or 0) >= 30:
                raise HTTPException(
                    status_code=402,
                    detail="Месячный лимит тикетов (30) тарифа Free исчерпан. Перейдите на тариф Solo для неограниченных задач."
                )
            workspace.tickets_used_this_month = (workspace.tickets_used_this_month or 0) + 1

        subscribers = list(project.subscribers or []) if project else []
        proj_slug = project.slug if project else ""
        proj_group_chat = getattr(project, 'group_chat', None) if project else None
        node_title = node.title if node else "Общий раздел"
        tier = entitlements.effective_tier(workspace) if workspace else "free"

        prefix = (proj_slug.split('_')[0].split('-')[0][:4] or 'VB').upper()
        ticket_key = getattr(data, 'key', None) or f"{prefix}-{seq_num}"

        ticket = SpecTicket(
            node_id=node_id,
            key=ticket_key,
            title=data.title,
            summary=data.summary,
            source_quote=data.source_quote,
            bug_context=getattr(data, 'bug_context', None) or {},
            status=data.status.value if hasattr(data.status, 'value') else str(data.status),
            priority=data.priority.value if hasattr(data.priority, 'value') else str(data.priority),
            checklists=data.checklists,
            criteria_contract=getattr(data, 'criteria_contract', None) or {},
            criteria_evidence={},
            quality_mode=getattr(data, 'quality_mode', 'strict') or 'strict',
            rework_notes=data.rework_notes,
            comments=data.comments,
            revision=0,
            is_deleted=False
        )
        if node:
            ticket.node = node
        project.revision = (project.revision or 0) + 1
        db.add(ticket)
        if commit:
            await db.commit()
            await db.refresh(ticket)
            await ticket_created_post_commit_side_effects(db, project, ticket, node_title, subscribers, proj_slug, proj_group_chat, tier)
        else:
            await db.flush()
            await db.refresh(ticket)

    return ticket

async def ticket_created_post_commit_side_effects(
    db: AsyncSession,
    project: Optional[Project],
    ticket: SpecTicket,
    node_title: str = "Общий раздел",
    subscribers: Optional[list] = None,
    proj_slug: str = "",
    proj_group_chat: Optional[dict] = None,
    tier: str = "free"
) -> None:
    if not project or not ticket:
        return
    if subscribers is None:
        subscribers = list(project.subscribers or [])
    if not proj_slug:
        proj_slug = project.slug or ""
    if proj_group_chat is None:
        proj_group_chat = getattr(project, 'group_chat', None)

    # 🛡️ Paywall on Telegram: included for Solo / Studio / Business or Demo
    if has_telegram_entitlement(tier, proj_slug):
        try:
            await telegram_service.notify_subscribers_on_new_ticket(
                subscribers,
                proj_slug,
                ticket.title,
                node_title,
                ticket.priority,
                ticket.summary,
                proj_group_chat
            )
        except Exception as e:
            import logging
            logging.getLogger("vibus.crud").warning(f"Telegram ticket notification failed: {e}")

    # 🐙 GitHub Issue Auto-Sync
    if project.github_sync_enabled and project.github_repo and project.github_token:
        try:
            gh_res = await github_service.create_github_issue_for_ticket(
                repo=project.github_repo,
                token=project.github_token,
                ticket=ticket,
                project_slug=proj_slug,
                node_title=node_title
            )

            if gh_res.get("ok"):
                ticket.github_issue_url = gh_res.get("issue_url")
                ticket.github_issue_number = gh_res.get("issue_number")
                await db.commit()
                await db.refresh(ticket)
        except Exception as e:
            import logging
            logging.getLogger("vibus.crud").warning(f"Auto-sync to GitHub failed: {e}")

async def update_ticket(db: AsyncSession, project_id: str, ticket_id: str, data: TicketUpdate, if_match: Optional[str] = None) -> Optional[SpecTicket]:
    result = await db.execute(
        select(SpecTicket)
        .join(SpecNode, SpecTicket.node_id == SpecNode.id)
        .where(SpecTicket.id == ticket_id, SpecNode.project_id == project_id, SpecTicket.is_deleted == False)
        .with_for_update()
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        return None

    if if_match is not None:
        curr_rev = ticket.revision or 0
        if str(curr_rev) != if_match.strip('"'):
            raise HTTPException(status_code=409, detail="Stale ticket revision")
        
    old_status = ticket.status
    old_contract = dict(ticket.criteria_contract or {})
    old_evidence = dict(ticket.criteria_evidence or {})
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if hasattr(ticket, key) and key != 'node_id':
            if hasattr(value, 'value'):
                value = value.value
            setattr(ticket, key, value)

    # Evidence is invalidated whenever the criterion definition changes or a claim is cleared.
    new_contract = {k: v for k, v in dict(ticket.criteria_contract or {}).items() if k in dict(ticket.checklists or {})}
    ticket.criteria_contract = new_contract
    new_evidence = dict(ticket.criteria_evidence or old_evidence)
    for criterion_key in set(old_contract) | set(new_contract):
        if old_contract.get(criterion_key) != new_contract.get(criterion_key):
            new_evidence.pop(criterion_key, None)
    for criterion_key, claimed in dict(ticket.checklists or {}).items():
        if claimed is not True:
            new_evidence.pop(criterion_key, None)
    new_evidence = {k: v for k, v in new_evidence.items() if k in new_contract}
    ticket.criteria_evidence = new_evidence
            
    ticket.revision = (ticket.revision or 0) + 1
            
    node_res = await db.execute(select(SpecNode).where(SpecNode.id == ticket.node_id))
    node = node_res.scalar_one_or_none()
    project = None
    workspace = None
    if node:
        p_res = await db.execute(select(Project).where(Project.id == node.project_id))
        project = p_res.scalar_one_or_none()
        if project and project.workspace_id:
            w_res = await db.execute(select(Workspace).where(Workspace.id == project.workspace_id))
            workspace = w_res.scalar_one_or_none()

    subscribers = list(project.subscribers or []) if project else []
    proj_slug = project.slug if project else ""
    proj_group_chat = getattr(project, 'group_chat', None) if project else None
    node_title = node.title if node else "Общий раздел"
    tier = entitlements.effective_tier(workspace) if workspace else "free"

    if project:
        project.revision = (project.revision or 0) + 1

    await db.commit()
    await db.refresh(ticket)

    if 'status' in update_data and old_status != ticket.status and project:
        if has_telegram_entitlement(tier, proj_slug):
            ticket_dict = {
                "id": ticket.id,
                "title": ticket.title,
                "summary": ticket.summary,
                "priority": ticket.priority,
                "node_title": node_title
            }
            await telegram_service.notify_subscribers_on_ticket_status(
                subscribers,
                proj_slug,
                ticket_dict,
                old_status,
                ticket.status,
                proj_group_chat
            )

    return ticket

async def delete_ticket(db: AsyncSession, project_id: str, ticket_id: str) -> bool:
    result = await db.execute(
        select(SpecTicket)
        .join(SpecNode, SpecTicket.node_id == SpecNode.id)
        .where(SpecTicket.id == ticket_id, SpecNode.project_id == project_id, SpecTicket.is_deleted == False)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        return False
    ticket.is_deleted = True
    p_res = await db.execute(select(Project).where(Project.id == project_id))
    project = p_res.scalar_one_or_none()
    if project:
        project.revision = (project.revision or 0) + 1
    await db.commit()
    return True

async def move_ticket(db: AsyncSession, project_id: str, ticket_id: str, dest_node_id: str, order: int = 0) -> Optional[SpecTicket]:
    dest_res = await db.execute(select(SpecNode).where(SpecNode.id == dest_node_id, SpecNode.project_id == project_id, SpecNode.is_deleted == False))
    dest_node = dest_res.scalar_one_or_none()
    if not dest_node:
        return None
    t_res = await db.execute(
        select(SpecTicket)
        .join(SpecNode, SpecTicket.node_id == SpecNode.id)
        .where(SpecTicket.id == ticket_id, SpecNode.project_id == project_id, SpecTicket.is_deleted == False)
    )
    ticket = t_res.scalar_one_or_none()
    if not ticket:
        return None
    ticket.node_id = dest_node_id
    ticket.order = order
    ticket.revision = (ticket.revision or 0) + 1
    p_res = await db.execute(select(Project).where(Project.id == project_id))
    project = p_res.scalar_one_or_none()
    if project:
        project.revision = (project.revision or 0) + 1
    await db.commit()
    await db.refresh(ticket)
    return ticket

async def update_project_settings(db: AsyncSession, project_id: str, data: dict) -> Project:
    p_res = await db.execute(select(Project).where(Project.id == project_id))
    project = p_res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    for key, value in data.items():
        if hasattr(project, key):
            setattr(project, key, value)
    project.revision = (project.revision or 0) + 1
    await db.commit()
    await db.refresh(project)
    return project

async def delete_column(db: AsyncSession, project_id: str, column_id: str) -> bool:
    p_res = await db.execute(select(Project).where(Project.id == project_id).with_for_update())
    project = p_res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    cols = [c for c in (project.columns or []) if c.get("id") != column_id]
    project.columns = cols

    # Determine valid fallback status from remaining columns, default to backlog
    fallback_status = "backlog"
    if cols:
        first_col_id = cols[0].get("id")
        if first_col_id:
            fallback_status = first_col_id

    nodes_res = await db.execute(select(SpecNode).where(SpecNode.project_id == project_id, SpecNode.is_deleted == False))
    node_ids = [n.id for n in nodes_res.scalars().all()]
    if node_ids:
        t_res = await db.execute(
            select(SpecTicket)
            .where(
                SpecTicket.node_id.in_(node_ids),
                SpecTicket.status == column_id,
                SpecTicket.is_deleted == False
            )
            .with_for_update()
        )
        tickets = t_res.scalars().all()
        for t in tickets:
            t.status = fallback_status
            t.revision = (t.revision or 0) + 1

    project.revision = (project.revision or 0) + 1
    await db.commit()
    return True

async def create_discussion(db: AsyncSession, project_id: str, node_id: str, data: schemas.DiscussionCreate) -> dict:
    result = await db.execute(
        select(SpecNode)
        .where(SpecNode.id == node_id, SpecNode.project_id == project_id, SpecNode.is_deleted == False)
        .with_for_update()
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    did = f"disc_{uuid.uuid4().hex[:12]}"
    disc = {
        "id": did,
        "quote": data.quote,
        "text": data.text,
        "author": data.author or "",
        "created_at": models.utcnow().isoformat(),
        "comments": [],
        "status": "open",
        "resolved": False,
        "created_ticket_ids": []
    }
    discs = list(node.discussions or [])
    discs.append(disc)
    node.discussions = discs
    flag_modified(node, "discussions")
    p_res = await db.execute(select(Project).where(Project.id == project_id))
    project = p_res.scalar_one_or_none()
    if project:
        project.revision = (project.revision or 0) + 1
    await db.commit()
    return disc

async def add_discussion_comment(db: AsyncSession, project_id: str, node_id: str, discussion_id: str, data: schemas.DiscussionCommentCreate) -> dict:
    result = await db.execute(
        select(SpecNode)
        .where(SpecNode.id == node_id, SpecNode.project_id == project_id, SpecNode.is_deleted == False)
        .with_for_update()
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    discs = list(node.discussions or [])
    found = None
    for d in discs:
        if d.get("id") == discussion_id:
            found = d
            break
    if not found:
        raise HTTPException(status_code=404, detail="Discussion not found")
    cid = f"c_{uuid.uuid4().hex[:8]}"
    comment = {
        "id": cid,
        "text": data.text,
        "author": data.author or "",
        "created_at": models.utcnow().isoformat()
    }
    found.setdefault("comments", []).append(comment)
    node.discussions = list(discs)
    flag_modified(node, "discussions")
    p_res = await db.execute(select(Project).where(Project.id == project_id))
    project = p_res.scalar_one_or_none()
    if project:
        project.revision = (project.revision or 0) + 1
    await db.commit()
    return comment

async def update_discussion(db: AsyncSession, project_id: str, node_id: str, discussion_id: str, data: schemas.DiscussionUpdate) -> dict:
    result = await db.execute(
        select(SpecNode)
        .where(SpecNode.id == node_id, SpecNode.project_id == project_id, SpecNode.is_deleted == False)
        .with_for_update()
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    discs = list(node.discussions or [])
    found = None
    for d in discs:
        if d.get("id") == discussion_id:
            found = d
            break
    if not found:
        raise HTTPException(status_code=404, detail="Discussion not found")
    if data.quote is not None:
        found["quote"] = data.quote
    if data.text is not None:
        found["text"] = data.text
    if data.status is not None:
        found["status"] = data.status
    if data.resolved is not None:
        found["resolved"] = data.resolved
        if data.resolved:
            found["status"] = "resolved"
    node.discussions = list(discs)
    flag_modified(node, "discussions")
    p_res = await db.execute(select(Project).where(Project.id == project_id))
    project = p_res.scalar_one_or_none()
    if project:
        project.revision = (project.revision or 0) + 1
    await db.commit()
    return found

async def convert_discussion_to_ticket(db: AsyncSession, project_id: str, node_id: str, discussion_id: str, data: schemas.DiscussionConvertToTicket) -> dict:
    result = await db.execute(
        select(SpecNode)
        .where(SpecNode.id == node_id, SpecNode.project_id == project_id, SpecNode.is_deleted == False)
        .with_for_update()
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    discs = list(node.discussions or [])
    found = None
    for d in discs:
        if d.get("id") == discussion_id:
            found = d
            break
    if not found:
        raise HTTPException(status_code=404, detail="Discussion not found")
    
    if found.get("created_ticket_ids"):
        ticket_id = found["created_ticket_ids"][0]
        t_res = await db.execute(select(SpecTicket).where(SpecTicket.id == ticket_id))
        existing_ticket = t_res.scalar_one_or_none()
        if existing_ticket:
            return {
                "status": "ok",
                "ticket": {
                    "id": existing_ticket.id,
                    "key": existing_ticket.key,
                    "title": existing_ticket.title,
                    "status": existing_ticket.status,
                    "priority": existing_ticket.priority,
                    "node_id": existing_ticket.node_id
                }
            }

    ticket_data = schemas.TicketCreate(
        title=data.title,
        priority=schemas.TicketPriorityEnum(data.priority) if data.priority in ("low", "medium", "high", "critical") else schemas.TicketPriorityEnum.medium,
        summary=data.summary or found.get("text", ""),
        source_quote=found.get("quote", "")
    )
    ticket = await create_ticket(db, project_id, node_id, ticket_data, commit=False)
    
    found["resolved"] = True
    found["status"] = "resolved"
    found["created_ticket_ids"] = list(set(found.get("created_ticket_ids", []) + [ticket.id]))
    node.discussions = list(discs)
    flag_modified(node, "discussions")

    p_res = await db.execute(select(Project).where(Project.id == project_id))
    project = p_res.scalar_one_or_none()
    await db.commit()
    await db.refresh(ticket)

    workspace = None
    if project and project.workspace_id:
        w_res = await db.execute(select(Workspace).where(Workspace.id == project.workspace_id))
        workspace = w_res.scalar_one_or_none()

    subscribers = list(project.subscribers or []) if project else []
    proj_slug = project.slug if project else ""
    proj_group_chat = getattr(project, 'group_chat', None) if project else None
    node_title = node.title if node else "Общий раздел"
    tier = entitlements.effective_tier(workspace) if workspace else "free"

    await ticket_created_post_commit_side_effects(db, project, ticket, node_title, subscribers, proj_slug, proj_group_chat, tier)

    return {
        "status": "ok",
        "ticket": {
            "id": ticket.id,
            "key": ticket.key,
            "title": ticket.title,
            "status": ticket.status,
            "priority": ticket.priority,
            "node_id": ticket.node_id
        }
    }

async def convert_feedback_to_ticket(db: AsyncSession, project_id: str, feedback_id: str, data: schemas.FeedbackConvertToTicket) -> dict:
    f_res = await db.execute(
        select(Feedback)
        .where(Feedback.id == feedback_id, Feedback.project_id == project_id)
        .with_for_update()
    )
    feedback = f_res.scalar_one_or_none()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")

    if feedback.converted_ticket_id:
        t_res = await db.execute(select(SpecTicket).where(SpecTicket.id == feedback.converted_ticket_id))
        existing_ticket = t_res.scalar_one_or_none()
        if existing_ticket:
            return {
                "status": "ok",
                "ticket": {
                    "id": existing_ticket.id,
                    "key": existing_ticket.key,
                    "title": existing_ticket.title,
                    "status": existing_ticket.status,
                    "priority": existing_ticket.priority,
                    "node_id": existing_ticket.node_id
                }
            }

    # Resolve runtime correlation before creating a ticket. Runtime ingest normally
    # created an AI-ready ticket already, so feedback must link to that ticket rather
    # than creating a duplicate card for the same crash.
    req_id = (feedback.details or {}).get("request_id")
    correlated_group = None
    correlated_ticket = None
    if req_id:
        group_res = await db.execute(
            select(ErrorGroup)
            .join(ErrorOccurrence, ErrorOccurrence.group_id == ErrorGroup.id)
            .where(
                ErrorGroup.project_id == project_id,
                ErrorOccurrence.request_id == req_id,
            )
            .order_by(ErrorOccurrence.created_at.desc())
            .limit(1)
            .with_for_update()
        )
        correlated_group = group_res.scalars().first()
        if correlated_group and correlated_group.ticket_id:
            t_res = await db.execute(
                select(SpecTicket)
                .where(
                    SpecTicket.id == correlated_group.ticket_id,
                    SpecTicket.is_deleted == False,
                )
                .with_for_update()
            )
            correlated_ticket = t_res.scalar_one_or_none()

    if correlated_ticket:
        feedback.status = "converted"
        feedback.converted_ticket_id = correlated_ticket.id

        comments = list(correlated_ticket.comments or [])
        comments.append({
            "id": f"c_{uuid.uuid4().hex[:8]}",
            "author": "VibeUs Correlation Engine",
            "text": (
                f"🔗 Feedback `{feedback.id}` связан с этим runtime-сбоем "
                f"(Request ID: `{req_id}`). Пользовательский контекст: "
                f"{feedback.text[:1000]}"
            ),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        correlated_ticket.comments = comments
        bug_context = dict(correlated_ticket.bug_context or {})
        linked = list(bug_context.get("linked_feedback_ids") or [])
        if feedback.id not in linked:
            linked.append(feedback.id)
        bug_context["linked_feedback_ids"] = linked[-50:]
        correlated_ticket.bug_context = bug_context
        correlated_ticket.revision = (correlated_ticket.revision or 0) + 1

        p_res = await db.execute(select(Project).where(Project.id == project_id).with_for_update())
        project = p_res.scalar_one_or_none()
        if project:
            project.revision = (project.revision or 0) + 1

        await db.commit()
        await db.refresh(correlated_ticket)
        return {
            "status": "ok",
            "ticket": {
                "id": correlated_ticket.id,
                "key": correlated_ticket.key,
                "title": correlated_ticket.title,
                "status": correlated_ticket.status,
                "priority": correlated_ticket.priority,
                "node_id": correlated_ticket.node_id,
            }
        }

    ticket_data = schemas.TicketCreate(
        title=data.title,
        priority=schemas.TicketPriorityEnum(data.priority) if data.priority in ("low", "medium", "high", "critical") else schemas.TicketPriorityEnum.medium,
        summary=data.summary or feedback.text
    )
    ticket = await create_ticket(db, project_id, data.node_id, ticket_data, commit=False)
    feedback.status = "converted"
    feedback.converted_ticket_id = ticket.id

    if correlated_group:
        # Legacy/malformed group without a ticket: repair the relationship by
        # attaching the new feedback-derived ticket.
        correlated_group.ticket_id = ticket.id
        comments = list(ticket.comments or [])
        comments.append({
            "id": f"c_{uuid.uuid4().hex[:8]}",
            "author": "VibeUs Correlation Engine",
            "text": (
                f"🔗 Feedback сопоставлен со сбоем в runtime: `{correlated_group.exception_type}` "
                f"на `{correlated_group.route or 'N/A'}` (Группа: `{correlated_group.id}`, "
                f"Request ID: `{req_id}`)."
            ),
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        ticket.comments = comments

    p_res = await db.execute(select(Project).where(Project.id == project_id))
    project = p_res.scalar_one_or_none()
    await db.commit()
    await db.refresh(ticket)

    node_res = await db.execute(select(SpecNode).where(SpecNode.id == data.node_id))
    node = node_res.scalar_one_or_none()
    workspace = None
    if project and project.workspace_id:
        w_res = await db.execute(select(Workspace).where(Workspace.id == project.workspace_id))
        workspace = w_res.scalar_one_or_none()

    subscribers = list(project.subscribers or []) if project else []
    proj_slug = project.slug if project else ""
    proj_group_chat = getattr(project, 'group_chat', None) if project else None
    node_title = node.title if node else "Общий раздел"
    tier = entitlements.effective_tier(workspace) if workspace else "free"

    await ticket_created_post_commit_side_effects(db, project, ticket, node_title, subscribers, proj_slug, proj_group_chat, tier)

    return {
        "status": "ok",
        "ticket": {
            "id": ticket.id,
            "key": ticket.key,
            "title": ticket.title,
            "status": ticket.status,
            "priority": ticket.priority,
            "node_id": ticket.node_id
        }
    }

async def batch_tickets_operation(db: AsyncSession, project_id: str, operation: str) -> dict:
    p_res = await db.execute(select(Project).where(Project.id == project_id))
    project = p_res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    nodes_res = await db.execute(select(SpecNode).where(SpecNode.project_id == project_id, SpecNode.is_deleted == False))
    node_ids = [n.id for n in nodes_res.scalars().all()]

    count = 0
    if node_ids:
        t_res = await db.execute(select(SpecTicket).where(SpecTicket.node_id.in_(node_ids), SpecTicket.is_deleted == False))
        tickets = t_res.scalars().all()

        if operation == "archive_done":
            for t in tickets:
                if t.status == "done" and not t.is_archived:
                    t.is_archived = True
                    t.revision = (t.revision or 0) + 1
                    count += 1
        elif operation == "start_backlog":
            for t in tickets:
                if t.status == "backlog":
                    t.status = "in_progress"
                    t.revision = (t.revision or 0) + 1
                    count += 1

    project.revision = (project.revision or 0) + 1
    await db.commit()
    return {"status": "ok", "updated_count": count, "revision": project.revision}

# === FULL BOARD / WS SYNC ===

async def get_full_board(db: AsyncSession, project_id: str) -> dict:
    project_result = await db.execute(select(Project).where(Project.id == project_id))
    project = project_result.scalar_one_or_none()
    
    workspace = None
    if project and project.workspace_id:
        w_res = await db.execute(select(Workspace).where(Workspace.id == project.workspace_id))
        workspace = w_res.scalar_one_or_none()

    nodes_res = await db.execute(select(SpecNode).where(SpecNode.project_id == project_id, SpecNode.is_deleted == False))
    nodes = nodes_res.scalars().all()
    if not nodes and project:
        default_node = SpecNode(
            project_id=project_id,
            title="Общие задачи и спецификация",
            description="Раздел задач проекта",
            content_markdown="### Спецификация проекта\nСпецификация и задачи проекта синхронизируются в реальном времени.",
            is_deleted=False
        )
        db.add(default_node)
        await db.commit()
        await db.refresh(default_node)
        nodes = [default_node]
    
    nodes_data = []
    for node in nodes:
        tickets = await get_tickets_by_node(db, node.id)
        nodes_data.append({
            "id": node.id,
            "title": node.title,
            "description": node.description,
            "parent_id": node.parent_id,
            "content_markdown": node.content_markdown,
            "discussions": node.discussions or [],
            "tickets": [
                {
                    "id": ticket.id,
                    "key": ticket.key or ticket.id,
                    "node_id": ticket.node_id,
                    "title": ticket.title,
                    "summary": ticket.summary,
                    "source_quote": ticket.source_quote or "",
                    "assignee": ticket.assignee or "",
                    "bug_context": ticket.bug_context or {},
                    "status": ticket.status,
                    "priority": ticket.priority,
                    "order": ticket.order,
                    "checklists": ticket.checklists or {},
                    "rework_notes": ticket.rework_notes or "",
                    "is_archived": getattr(ticket, 'is_archived', False),
                    "revision": getattr(ticket, 'revision', 0) or 0,
                    "comments": ticket.comments or [],
                    "created_at": ticket.created_at.isoformat() if ticket.created_at else None
                }
                for ticket in tickets
                if not getattr(ticket, 'is_deleted', False)
            ]
        })
    
    fb_res = await db.execute(select(Feedback).where(Feedback.project_id == project_id))
    db_feedbacks = [
        {
            "id": fb.id,
            "idempotency_key": fb.idempotency_key,
            "text": fb.text,
            "category": fb.category,
            "status": fb.status,
            "converted_ticket_id": fb.converted_ticket_id,
            "created_at": fb.created_at.isoformat() if fb.created_at else None,
            **(fb.details or {})
        }
        for fb in fb_res.scalars().all()
    ]
    legacy_feedbacks = [f for f in (getattr(project, 'feedbacks', []) or []) if isinstance(f, dict) and f.get("id") not in {x["id"] for x in db_feedbacks}]
    all_feedbacks = db_feedbacks + legacy_feedbacks

    return {
        "project_id": project_id,
        "revision": int(project.revision or 0) if project else 0,
        "subscription_tier": entitlements.effective_tier(workspace) if workspace else "free",
        "is_lifetime_free": getattr(workspace, 'is_lifetime_free', False) if workspace else False,
        "slug": project.slug if project else "",
        "columns": project.columns if project else [],
        "subscribers": project.subscribers if project else [],
        "custom_roles": project.custom_roles if project and hasattr(project, 'custom_roles') else [],
        "custom_boards": project.custom_boards if project and hasattr(project, 'custom_boards') else [],
        "boards": project.custom_boards if project and hasattr(project, 'custom_boards') else [],
        "feedbacks": all_feedbacks,
        "group_chat": getattr(project, 'group_chat', None) if project else None,
        "telemetry_enabled": getattr(project, 'telemetry_enabled', False) if project else False,
        "ai_data_sharing": getattr(project, 'ai_data_sharing', False) if project else False,
        "nodes": nodes_data
    }

async def sync_board_from_ws(db: AsyncSession, project_id: str, board_data: dict):
    # Non-destructive sync with soft-delete protection
    incoming_nodes = board_data.get('nodes', [])
    
    existing_nodes = await get_nodes_by_project(db, project_id)
    existing_nodes_map = {n.id: n for n in existing_nodes}
    
    # Sync project metadata if provided
    project_res = await db.execute(select(Project).where(Project.id == project_id))
    project = project_res.scalar_one_or_none()
    if project:
        if board_data.get('columns'):
            project.columns = board_data['columns']
        if board_data.get('custom_roles'):
            project.custom_roles = board_data['custom_roles']
        if board_data.get('custom_boards') is not None:
            project.custom_boards = board_data['custom_boards']
        elif board_data.get('boards') is not None:
            project.custom_boards = board_data['boards']
        if board_data.get('feedbacks'):
            project.feedbacks = board_data['feedbacks']
        if board_data.get('group_chat'):
            project.group_chat = board_data['group_chat']
        if 'telemetry_enabled' in board_data:
            project.telemetry_enabled = board_data['telemetry_enabled']
        if 'ai_data_sharing' in board_data:
            project.ai_data_sharing = board_data['ai_data_sharing']
    
    # Soft-delete nodes that were removed from incoming payload
    incoming_node_ids = {in_n.get('id') for in_n in incoming_nodes if in_n.get('id')}
    if len(incoming_nodes) > 0:
        for existing_n in existing_nodes:
            if existing_n.id not in incoming_node_ids:
                existing_n.is_deleted = True
                node_tickets = await get_tickets_by_node(db, existing_n.id)
                for t in node_tickets:
                    t.is_deleted = True

    for in_node in incoming_nodes:
        node_id = in_node.get('id')
        node = None
        if node_id and node_id in existing_nodes_map:
            node = existing_nodes_map[node_id]
        elif len(existing_nodes) == 1 and len(incoming_nodes) == 1:
            node = existing_nodes[0]
            
        if node:
            # Update node
            if 'parent_id' in in_node:
                node.parent_id = in_node.get('parent_id')
            node.title = in_node.get('title', node.title)
            node.description = in_node.get('description', node.description)
            node.content_markdown = in_node.get('content_markdown', node.content_markdown)
            node.discussions = in_node.get('discussions', node.discussions)
            
            # Sync tickets
            existing_tickets = await get_tickets_by_node(db, node.id)
            existing_tickets_map = {t.id: t for t in existing_tickets}
            
            incoming_tickets = in_node.get('tickets', [])
            incoming_ticket_ids = {in_t.get('id') for in_t in incoming_tickets if in_t.get('id')}
            
            # Soft-delete tickets that were removed in the incoming payload
            for existing_t in existing_tickets:
                if existing_t.id not in incoming_ticket_ids:
                    existing_t.is_deleted = True

            for in_ticket in incoming_tickets:
                t_id = in_ticket.get('id')
                if t_id and t_id in existing_tickets_map:
                    # Update ticket
                    ticket = existing_tickets_map[t_id]
                    ticket.title = in_ticket.get('title', ticket.title)
                    ticket.key = in_ticket.get('key', ticket.key)
                    ticket.summary = in_ticket.get('summary', ticket.summary)
                    ticket.source_quote = in_ticket.get('source_quote', ticket.source_quote)
                    ticket.status = in_ticket.get('status', ticket.status)
                    ticket.priority = in_ticket.get('priority', ticket.priority)
                    ticket.order = in_ticket.get('order', ticket.order)
                    ticket.checklists = in_ticket.get('checklists', ticket.checklists)
                    ticket.rework_notes = in_ticket.get('rework_notes', ticket.rework_notes)
                    ticket.comments = in_ticket.get('comments', ticket.comments)
                    ticket.assignee = in_ticket.get('assignee', ticket.assignee)
                    ticket.bug_context = in_ticket.get('bug_context', ticket.bug_context)
                    ticket.is_archived = in_ticket.get('is_archived', ticket.is_archived)
                    ticket.is_deleted = False
                else:
                    # New ticket created via WS
                    new_ticket = SpecTicket(
                        id=t_id or str(uuid.uuid4()),
                        node_id=node.id,
                        key=in_ticket.get('key', ''),
                        title=in_ticket.get('title', 'Новая задача'),
                        summary=in_ticket.get('summary', ''),
                        source_quote=in_ticket.get('source_quote', ''),
                        status=in_ticket.get('status', 'backlog'),
                        priority=in_ticket.get('priority', 'medium'),
                        order=in_ticket.get('order', 0),
                        checklists=in_ticket.get('checklists', {}),
                        rework_notes=in_ticket.get('rework_notes', ''),
                        comments=in_ticket.get('comments', []),
                        assignee=in_ticket.get('assignee', ''),
                        bug_context=in_ticket.get('bug_context', {}),
                        is_archived=in_ticket.get('is_archived', False),
                        is_deleted=False
                    )
                    new_ticket.node = node
                    db.add(new_ticket)
        else:
            # New node created via WS
            new_node = SpecNode(
                id=node_id or str(uuid.uuid4()),
                project_id=project_id,
                parent_id=in_node.get('parent_id'),
                title=in_node.get('title', 'Новый раздел'),
                description=in_node.get('description', ''),
                content_markdown=in_node.get('content_markdown', ''),
                discussions=in_node.get('discussions', []),
                is_deleted=False
            )
            db.add(new_node)
            await db.flush()
            
            for in_ticket in in_node.get('tickets', []):
                new_ticket = SpecTicket(
                    id=in_ticket.get('id') or str(uuid.uuid4()),
                    node_id=new_node.id,
                    key=in_ticket.get('key', ''),
                    title=in_ticket.get('title', 'Новая задача'),
                    summary=in_ticket.get('summary', ''),
                    source_quote=in_ticket.get('source_quote', ''),
                    status=in_ticket.get('status', 'backlog'),
                    priority=in_ticket.get('priority', 'medium'),
                    order=in_ticket.get('order', 0),
                    checklists=in_ticket.get('checklists', {}),
                    rework_notes=in_ticket.get('rework_notes', ''),
                    comments=in_ticket.get('comments', []),
                    assignee=in_ticket.get('assignee', ''),
                    bug_context=in_ticket.get('bug_context', {}),
                    is_archived=in_ticket.get('is_archived', False),
                    is_deleted=False
                )
                new_ticket.node = new_node
                db.add(new_ticket)
                
    await db.commit()

import secrets
from datetime import timedelta, datetime, timezone

async def create_access_link(db: AsyncSession, project_id: str, data: schemas.AccessLinkCreate) -> tuple[ProjectAccessLink, str]:
    raw_token = f"vbs_{secrets.token_hex(16)}"
    token_digest = hash_access_token(raw_token)
    expires_at = None
    if data.ttl == "24h" or data.ttl == schemas.TtlEnum.d1:
        expires_at = models.utcnow() + timedelta(hours=24)
    elif data.ttl == "7d" or data.ttl == schemas.TtlEnum.d7:
        expires_at = models.utcnow() + timedelta(days=7)
    elif data.ttl == "30d" or data.ttl == schemas.TtlEnum.d30:
        expires_at = models.utcnow() + timedelta(days=30)
        
    link = ProjectAccessLink(
        project_id=project_id,
        token_hash=token_digest,
        label=data.label,
        role=data.role.value if hasattr(data.role, 'value') else str(data.role),
        ttl=data.ttl.value if hasattr(data.ttl, 'value') else str(data.ttl),
        single_use=data.single_use,
        expires_at=expires_at
    )
    db.add(link)
    db.add(AuditEvent(project_id=project_id, event_type="access_link.created"))
    await db.commit()
    await db.refresh(link)
    return link, raw_token

async def get_project_access_links(db: AsyncSession, project_id: str) -> List[ProjectAccessLink]:
    result = await db.execute(select(ProjectAccessLink).where(ProjectAccessLink.project_id == project_id))
    return list(result.scalars().all())

async def delete_access_link(db: AsyncSession, project_id: str, link_id: str) -> bool:
    result = await db.execute(select(ProjectAccessLink).where(ProjectAccessLink.id == link_id, ProjectAccessLink.project_id == project_id))
    link = result.scalar_one_or_none()
    if not link:
        return False
    db.add(AuditEvent(project_id=project_id, event_type="access_link.revoked"))
    await db.delete(link)
    await db.commit()
    return True

async def verify_and_consume_access_link(db: AsyncSession, token: str, fingerprint: Optional[str] = None) -> schemas.AccessLinkVerifyResponse:
    digest = hash_access_token(token)
    result = await db.execute(
        select(ProjectAccessLink)
        .where(ProjectAccessLink.token_hash == digest)
        .with_for_update()
    )
    link = result.scalar_one_or_none()
    
    if not link:
        return schemas.AccessLinkVerifyResponse(valid=False, error="Link not found")
        
    if link.expires_at and link.expires_at < models.utcnow():
        return schemas.AccessLinkVerifyResponse(valid=False, error="Link expired")
        
    if link.single_use:
        if link.is_activated:
            if not fingerprint or link.activated_fingerprint != fingerprint:
                return schemas.AccessLinkVerifyResponse(valid=False, error="Link already used")
        else:
            link.is_activated = True
            if fingerprint:
                link.activated_fingerprint = fingerprint
            link.activated_at = models.utcnow()
            await db.commit()
            
    project_res = await db.execute(select(Project).where(Project.id == link.project_id))
    project = project_res.scalar_one_or_none()
    
    if not project:
        return schemas.AccessLinkVerifyResponse(valid=False, error="Project not found")
        
    return schemas.AccessLinkVerifyResponse(valid=True, role=link.role, project_slug=project.slug, access_token=token)
