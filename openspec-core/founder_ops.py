from __future__ import annotations

import hashlib
import re
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import auth
import control_router
import models
import product_radar
from database import get_db


router = APIRouter(prefix="/api/control", tags=["control-founder-workbench"])
runtime_router = APIRouter(tags=["founder-runtime-controls"])

CHECKLIST_EVENT = "admin.launch_checklist.updated"
SUPPORT_NOTE_EVENT = "admin.support_note.created"
PRIVACY_REQUEST_EVENT = "admin.privacy_request.updated"
FEATURE_FLAG_EVENT = "admin.feature_flag.saved"
ANNOUNCEMENT_EVENT = "admin.announcement.saved"


# This catalog is founder-only operating guidance, not a promise that a third-party
# community will accept a post. Community/submission rules change; every community
# item therefore explicitly requires a rules check before publishing.
LAUNCH_CHECKLIST: tuple[dict[str, Any], ...] = (
    {
        "key": "owned_landing_launch_story",
        "group": "Owned",
        "channel": "VibeUs landing / changelog",
        "market": "RU + EN",
        "goal": "Сформулировать один понятный launch narrative и единый CTA до внешнего трафика.",
        "format": "Короткий launch-блок: проблема → 20-секундный demo → кому полезно → CTA попробовать.",
        "preflight": ["Проверить тарифы и CTA", "Проверить mobile", "Проверить legal/refund links", "Проверить analytics attribution"],
        "success_signal": "Посетитель понимает пользу без созвона; landing→signup становится измеримым после instrumentation.",
        "destination": "/",
        "rules_note": "Owned surface; держать сообщение синхронным с README и публичными тарифами.",
    },
    {
        "key": "github_release",
        "group": "Developer",
        "channel": "GitHub Release",
        "market": "Global",
        "goal": "Дать разработчикам каноническую точку релиза и changelog.",
        "format": "Release notes: what it solves, 3–5 capabilities, install/start, screenshots/GIF, known limitations.",
        "preflight": ["Tag version", "Green release gate", "README quick start", "No secrets in examples"],
        "success_signal": "Release views/stars/clones и переходы на продукт без роста support confusion.",
        "destination": "https://github.com/AlexeyPlaton/VibeUs/releases",
        "rules_note": "Публиковать только реально выпущенную версию; не обещать незавершённые provider capabilities.",
    },
    {
        "key": "github_discovery",
        "group": "Developer",
        "channel": "GitHub README + topics",
        "market": "Global",
        "goal": "Сделать репозиторий понятным из поиска GitHub за 30 секунд.",
        "format": "Hero value proposition, demo, quick start, architecture/trust section, hosted CTA, self-hosting boundary.",
        "preflight": ["Topics describe category", "Social preview", "Demo works", "Issue templates", "Security policy"],
        "success_signal": "Stars/visits приводят к quick-start и hosted signup, а не только к просмотру README.",
        "destination": "https://github.com/AlexeyPlaton/VibeUs",
        "rules_note": "Не оптимизировать под stars в ущерб конверсии в реальную ценность.",
    },
    {
        "key": "product_hunt",
        "group": "Launch",
        "channel": "Product Hunt",
        "market": "Global",
        "goal": "Получить концентрированную волну ранней обратной связи и первых международных пользователей.",
        "format": "Launch page + короткое demo + maker comment с историей проблемы, не рекламный пресс-релиз.",
        "preflight": ["Проверить текущие launch rules", "Подготовить visuals", "FAQ", "Быть онлайн для ответов", "Attribution tag"],
        "success_signal": "Activated/value workspaces и содержательная обратная связь, а не место в дневном рейтинге само по себе.",
        "destination": "https://www.producthunt.com/",
        "rules_note": "Перед запуском проверить действующие правила Product Hunt и требования к launch assets.",
    },
    {
        "key": "show_hn",
        "group": "Developer",
        "channel": "Hacker News · Show HN",
        "market": "Global",
        "goal": "Проверить ценность продукта на технически требовательной аудитории.",
        "format": "Show HN: VibeUs — what it does; внутри: почему сделали, архитектурные trade-offs, ссылка на рабочий продукт/repo.",
        "preflight": ["Проверить актуальные Show HN guidelines", "Продукт доступен без sales call", "Ответить на технические вопросы"],
        "success_signal": "Качественные обсуждения, activation и GitHub engagement; не пытаться искусственно бустить голоса.",
        "destination": "https://news.ycombinator.com/show",
        "rules_note": "Проверить текущие HN guidelines; никакого vote solicitation или массовой координации голосов.",
    },
    {
        "key": "indie_hackers",
        "group": "Founder",
        "channel": "Indie Hackers",
        "market": "Global",
        "goal": "Найти founder/developer early adopters через историю проблемы и строительства продукта.",
        "format": "Build story + конкретный workflow before/after + что пока не работает + просьба покритиковать.",
        "preflight": ["Проверить правила сообщества", "Не маскировать рекламу под вопрос", "Дать реальные детали"],
        "success_signal": "Разговоры с ICP, регистрации и повторная ценность, а не охват поста.",
        "destination": "https://www.indiehackers.com/",
        "rules_note": "Проверить действующие правила self-promotion перед публикацией.",
    },
    {
        "key": "reddit_relevant",
        "group": "Community",
        "channel": "Reddit · релевантные dev/QA/founder сообщества",
        "market": "Global",
        "goal": "Получить problem-aware пользователей из конкретных сообществ.",
        "format": "Отдельный пост под контекст сообщества: кейс/разбор/полезный артефакт; продукт — только там, где это разрешено и уместно.",
        "preflight": ["Выбрать только релевантные сообщества", "Прочитать текущие правила каждого", "Не cross-post spam", "Пометить affiliation"],
        "success_signal": "Качественные переходы и диалог; negative moderation signal = остановиться и изменить подход.",
        "destination": "https://www.reddit.com/",
        "rules_note": "Правила сильно различаются по subreddit; проверять непосредственно перед каждым постом.",
    },
    {
        "key": "devto_hashnode",
        "group": "Content",
        "channel": "DEV / Hashnode",
        "market": "Global",
        "goal": "Собрать evergreen technical discovery через полезный инженерный материал.",
        "format": "Технический разбор: visual feedback → reproducible task → evidence → human acceptance; VibeUs как реализация подхода.",
        "preflight": ["Статья полезна без покупки", "Code/examples checked", "Canonical link strategy", "Clear disclosure"],
        "success_signal": "Долгий хвост referral traffic и активированные developer workspaces.",
        "destination": "https://dev.to/",
        "rules_note": "Проверить текущие editorial/self-promo правила площадки.",
    },
    {
        "key": "linkedin_founder",
        "group": "Social",
        "channel": "LinkedIn",
        "market": "Global",
        "goal": "Дойти до техлидов, founders, QA/dev managers через личный founder narrative.",
        "format": "Короткая история боли + GIF/demo + 1 конкретный результат + вопрос/CTA.",
        "preflight": ["Пост от живого founder voice", "Один CTA", "Demo readable without sound", "UTM/source tag"],
        "success_signal": "ICP conversations, demos/signups и дальнейшая activation.",
        "destination": "https://www.linkedin.com/",
        "rules_note": "Не превращать серию постов в одинаковый рекламный шаблон; тестировать разные problem angles.",
    },
    {
        "key": "x_builder",
        "group": "Social",
        "channel": "X / developer-founder audience",
        "market": "Global",
        "goal": "Быстро тестировать формулировки проблемы и demo snippets.",
        "format": "Один сильный тезис + короткий visual demo; тред только если есть содержательная история.",
        "preflight": ["Source tag", "Readable visual", "No engagement bait", "Ответы в первые часы"],
        "success_signal": "Клики → activation/value, а не impressions сами по себе.",
        "destination": "https://x.com/",
        "rules_note": "Использовать как быстрый learning channel, не как vanity-metric channel.",
    },
    {
        "key": "habr",
        "group": "Content",
        "channel": "Хабр",
        "market": "RU",
        "goal": "Доказать инженерную глубину продукта российской технической аудитории.",
        "format": "Полноценная техническая статья о проблеме feedback-to-engineering и доверенных критериях; продукт как реальный кейс.",
        "preflight": ["Проверить текущие правила публикации", "Статья самостоятельна", "Технические детали проверены", "Не делать рекламный лендинг текстом"],
        "success_signal": "Релевантные разработчики/QA пробуют продукт и возвращаются за второй ценностью.",
        "destination": "https://habr.com/",
        "rules_note": "Перед публикацией проверить актуальные требования к корпоративным/личным материалам и рекламе.",
    },
    {
        "key": "vc_ru",
        "group": "Founder",
        "channel": "vc.ru",
        "market": "RU",
        "goal": "Проверить founder/business narrative и ценность для небольших продуктовых команд.",
        "format": "История: почему обычный feedback теряется → как меняется цикл разработки → цифры после запуска.",
        "preflight": ["Проверить текущие правила площадки", "Не обещать метрики до появления данных", "Показать продукт"],
        "success_signal": "ICP signups и запросы от команд, а не комментарии ради комментариев.",
        "destination": "https://vc.ru/",
        "rules_note": "Проверить текущую маркировку/правила коммерческих публикаций перед размещением.",
    },
    {
        "key": "telegram_dev_qa",
        "group": "Community",
        "channel": "Telegram · dev/QA/product communities",
        "market": "RU",
        "goal": "Дойти до QA/dev команд через доверенные тематические сообщества.",
        "format": "Не массовый посев: короткий полезный кейс/демо, адаптированный под конкретный канал и согласованный с правилами.",
        "preflight": ["Составить 10–20 релевантных каналов/чатов", "Проверить правила", "Согласовать размещение где нужно", "Разные source tags"],
        "success_signal": "Activation/value по каждому источнику; слабые источники выключать, сильные повторять.",
        "destination": "https://telegram.org/",
        "rules_note": "Не спамить одинаковым сообщением; правила и коммерческие условия каждого сообщества проверять отдельно.",
    },
    {
        "key": "direct_beta_outreach",
        "group": "Direct",
        "channel": "Личный outreach к beta users",
        "market": "RU + EN",
        "goal": "Получить первые 10–30 качественных наблюдений за реальным использованием, а не массовый шум.",
        "format": "Персональное сообщение: почему именно этому человеку может быть полезно + 1 demo + просьба попробовать реальную задачу.",
        "preflight": ["Только релевантные контакты", "Не автоматизировать холодный спам", "Готов сценарий интервью", "Записывать objections/tags"],
        "success_signal": "First value, repeat value, интервью и concrete objections.",
        "destination": "",
        "rules_note": "Качество контакта важнее количества; уважать opt-out и приватность.",
    },
    {
        "key": "partner_outreach",
        "group": "Partnerships",
        "channel": "Партнёры: QA/dev agencies, tools, communities",
        "market": "RU + EN",
        "goal": "Найти каналы, где VibeUs дополняет существующий workflow вместо покупки рекламы.",
        "format": "Короткий partner one-pager: общая аудитория, use case, интеграция/контент, что получает партнёр.",
        "preflight": ["Список 20 релевантных партнёров", "Конкретная взаимная ценность", "Не обещать интеграцию до оценки"],
        "success_signal": "Qualified referrals, совместные кейсы, интеграции с измеримой activation.",
        "destination": "",
        "rules_note": "Сначала 3–5 ручных пилотов, затем масштабирование партнёрского motion.",
    },
    {
        "key": "directories_reviews",
        "group": "Discovery",
        "channel": "Каталоги / review sites",
        "market": "Global",
        "goal": "Создать долгоживущие discovery surfaces после подтверждения positioning.",
        "format": "Единый короткий profile, screenshots, category, pricing link, support/legal links.",
        "preflight": ["Сначала подтвердить ICP/positioning", "Выбирать живые каталоги", "Проверять правила и стоимость", "Не покупать фиктивные отзывы"],
        "success_signal": "Referral activation и search discovery; удалять каналы без качественного трафика.",
        "destination": "",
        "rules_note": "Конкретный список каталогов пересматривать по актуальности, а не хранить навечно в коде.",
    },
)


CAPABILITY_STATUS: tuple[dict[str, str], ...] = (
    {"key": "customer_360", "status": "implemented", "detail": "Read-only cross-workspace customer timeline and diagnostic snapshot."},
    {"key": "support_notes", "status": "implemented", "detail": "Append-only founder support notes/tags with platform-admin step-up."},
    {"key": "error_center", "status": "implemented", "detail": "Cross-project error-group triage view without changing customer error state."},
    {"key": "payment_reconciliation", "status": "implemented_local", "detail": "Local ledger/entitlement/fiscal invariant reconciliation. Provider truth remains separate."},
    {"key": "privacy_requests", "status": "implemented_case_management", "detail": "Tracked export/delete/anonymize/rectify cases and previews; destructive execution is intentionally manual."},
    {"key": "cohorts_funnel", "status": "implemented", "detail": "Signup cohort activation/paid conversion plus explicit missing landing denominator."},
    {"key": "feature_flags", "status": "implemented", "detail": "Founder flag registry plus authenticated deterministic runtime evaluation."},
    {"key": "announcements", "status": "implemented", "detail": "Founder announcement registry plus authenticated workspace/tier targeting."},
    {"key": "customer_view", "status": "implemented_safe", "detail": "Sanitized read-only diagnostic snapshot; never impersonates or mints a customer session."},
    {"key": "founder_shortcuts", "status": "implemented", "detail": "One-click navigation to radar, operations, live AI brief and account."},
    {"key": "platform_admin_mfa", "status": "blocked_security_dependency", "detail": "Requires a real WebAuthn/passkey credential lifecycle and recovery policy; no fake toggle is exposed."},
    {"key": "provider_refund_cancel", "status": "blocked_external_dependency", "detail": "Requires the approved live billing provider and verified refund/recurring-cancel semantics before remote mutations are exposed."},
)


class ChecklistUpdate(BaseModel):
    status: Literal["todo", "preparing", "published", "skipped"]
    link: str = Field(default="", max_length=2048)
    notes: str = Field(default="", max_length=3000)


class SupportNoteCreate(BaseModel):
    note: str = Field(min_length=1, max_length=3000)
    tags: list[str] = Field(default_factory=list, max_length=20)


class PrivacyRequestCreate(BaseModel):
    user_id: str
    request_type: Literal["export", "delete", "anonymize", "rectify"]
    reason: str = Field(default="", max_length=2000)


class PrivacyRequestUpdate(BaseModel):
    status: Literal["open", "verifying", "ready", "completed", "rejected", "blocked_retention"]
    note: str = Field(default="", max_length=2000)


class FeatureFlagUpsert(BaseModel):
    key: str = Field(min_length=2, max_length=80, pattern=r"^[a-z][a-z0-9_.-]+$")
    description: str = Field(default="", max_length=500)
    enabled: bool = False
    rollout_pct: int = Field(default=0, ge=0, le=100)
    workspace_ids: list[str] = Field(default_factory=list, max_length=100)
    expires_at: datetime | None = None


class AnnouncementUpsert(BaseModel):
    announcement_id: str | None = Field(default=None, max_length=80)
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=3000)
    active: bool = False
    tiers: list[str] = Field(default_factory=list, max_length=10)
    workspace_ids: list[str] = Field(default_factory=list, max_length=100)
    starts_at: datetime | None = None
    ends_at: datetime | None = None


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _clean_tags(tags: list[str]) -> list[str]:
    clean: list[str] = []
    for raw in tags:
        tag = re.sub(r"\s+", " ", str(raw or "").strip())[:40]
        if tag and tag.lower() not in {item.lower() for item in clean}:
            clean.append(tag)
    return clean[:20]


async def _events(db: AsyncSession, event_type: str) -> list[models.AuditEvent]:
    return list((await db.execute(
        select(models.AuditEvent)
        .where(models.AuditEvent.event_type == event_type)
        .order_by(models.AuditEvent.created_at.asc(), models.AuditEvent.id.asc())
    )).scalars().all())


async def _latest_records(db: AsyncSession, event_type: str, key_field: str) -> dict[str, dict[str, Any]]:
    state: dict[str, dict[str, Any]] = {}
    for event in await _events(db, event_type):
        details = dict(event.details or {})
        key = str(details.get(key_field) or "").strip()
        if not key:
            continue
        details["updated_at"] = _iso(event.created_at)
        state[key] = details
    return state


async def _append_event(
    db: AsyncSession,
    admin: models.User,
    event_type: str,
    details: dict[str, Any],
    *,
    workspace_id: str | None = None,
    project_id: str | None = None,
) -> models.AuditEvent:
    event = models.AuditEvent(
        user_id=admin.id,
        workspace_id=workspace_id,
        project_id=project_id,
        event_type=event_type,
        details=details,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def _target_user(db: AsyncSession, user_id: str) -> models.User:
    target = (await db.execute(select(models.User).where(models.User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    return target


async def _launch_checklist(db: AsyncSession) -> list[dict[str, Any]]:
    progress = await _latest_records(db, CHECKLIST_EVENT, "key")
    items: list[dict[str, Any]] = []
    for source in LAUNCH_CHECKLIST:
        item = dict(source)
        saved = progress.get(item["key"], {})
        item.update({
            "status": saved.get("status", "todo"),
            "link": saved.get("link", ""),
            "notes": saved.get("notes", ""),
            "published_at": saved.get("published_at"),
            "updated_at": saved.get("updated_at"),
        })
        items.append(item)
    return items


@router.get("/launch-checklist")
async def get_launch_checklist(
    _admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    items = await _launch_checklist(db)
    counts = {status: sum(1 for item in items if item["status"] == status) for status in ("todo", "preparing", "published", "skipped")}
    return {"items": items, "counts": counts, "total": len(items)}


@router.patch("/launch-checklist/{key}")
async def update_launch_checklist(
    key: str,
    payload: ChecklistUpdate,
    admin: models.User = Depends(control_router.require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    catalog = {item["key"]: item for item in LAUNCH_CHECKLIST}
    if key not in catalog:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    previous = (await _latest_records(db, CHECKLIST_EVENT, "key")).get(key, {})
    now = models.utcnow()
    published_at = previous.get("published_at")
    if payload.status == "published" and not published_at:
        published_at = _iso(now)
    if payload.status != "published":
        published_at = None
    details = {
        "key": key,
        "status": payload.status,
        "link": payload.link.strip(),
        "notes": payload.notes.strip(),
        "published_at": published_at,
    }
    event = await _append_event(db, admin, CHECKLIST_EVENT, details)
    return {**catalog[key], **details, "updated_at": _iso(event.created_at)}


async def _recent_customers(db: AsyncSession, limit: int = 50) -> list[dict[str, Any]]:
    users = list((await db.execute(
        select(models.User).order_by(models.User.created_at.desc()).limit(limit)
    )).scalars().all())
    user_ids = [user.id for user in users]
    memberships = list((await db.execute(
        select(models.WorkspaceMembership).where(models.WorkspaceMembership.user_id.in_(user_ids))
    )).scalars().all()) if user_ids else []
    by_user: dict[str, list[str]] = defaultdict(list)
    for membership in memberships:
        by_user[membership.user_id].append(membership.workspace_id)
    return [
        {
            "id": user.id,
            "email": user.email,
            "is_active": bool(user.is_active),
            "created_at": _iso(user.created_at),
            "workspace_ids": by_user.get(user.id, []),
        }
        for user in users
    ]


@router.get("/founder/customers")
async def founder_customers(
    limit: int = Query(default=50, ge=1, le=200),
    _admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    return {"customers": await _recent_customers(db, limit)}


async def _customer_timeline(db: AsyncSession, target: models.User) -> dict[str, Any]:
    memberships = list((await db.execute(
        select(models.WorkspaceMembership).where(models.WorkspaceMembership.user_id == target.id)
    )).scalars().all())
    workspace_ids = [item.workspace_id for item in memberships]
    workspaces = list((await db.execute(
        select(models.Workspace).where(models.Workspace.id.in_(workspace_ids))
    )).scalars().all()) if workspace_ids else []
    projects = list((await db.execute(
        select(models.Project).where(
            models.Project.workspace_id.in_(workspace_ids),
            models.Project.is_deleted == False,
        )
    )).scalars().all()) if workspace_ids else []
    project_ids = [item.id for item in projects]
    payments = list((await db.execute(
        select(models.Payment).where(models.Payment.workspace_id.in_(workspace_ids))
        .order_by(models.Payment.created_at.desc())
    )).scalars().all()) if workspace_ids else []
    feedback = list((await db.execute(
        select(models.Feedback).where(models.Feedback.project_id.in_(project_ids))
        .order_by(models.Feedback.created_at.desc()).limit(100)
    )).scalars().all()) if project_ids else []
    errors = list((await db.execute(
        select(models.ErrorGroup).where(models.ErrorGroup.project_id.in_(project_ids))
        .order_by(models.ErrorGroup.last_seen_at.desc()).limit(100)
    )).scalars().all()) if project_ids else []
    audit = list((await db.execute(
        select(models.AuditEvent)
        .where(or_(
            models.AuditEvent.user_id == target.id,
            models.AuditEvent.workspace_id.in_(workspace_ids) if workspace_ids else False,
            models.AuditEvent.project_id.in_(project_ids) if project_ids else False,
        ))
        .order_by(models.AuditEvent.created_at.desc()).limit(150)
    )).scalars().all())

    timeline: list[dict[str, Any]] = [
        {"at": _iso(target.created_at), "kind": "user.created", "title": "Account created", "meta": {}}
    ]
    for workspace in workspaces:
        timeline.append({"at": _iso(workspace.created_at), "kind": "workspace.created", "title": "Workspace created", "meta": {"workspace_id": workspace.id, "name": workspace.name}})
    for project in projects:
        timeline.append({"at": _iso(project.created_at), "kind": "project.created", "title": "Project created", "meta": {"project_id": project.id, "slug": project.slug, "name": project.name}})
    for item in feedback:
        timeline.append({"at": _iso(item.created_at), "kind": "feedback.captured", "title": "Feedback captured", "meta": {"project_id": item.project_id, "category": item.category, "status": item.status, "converted": bool(item.converted_ticket_id)}})
    for item in errors:
        timeline.append({"at": _iso(item.last_seen_at), "kind": "runtime_error.group", "title": "Runtime error group", "meta": {"project_id": item.project_id, "status": item.status, "service": item.service, "occurrences": item.occurrences_count, "ticket_id": item.ticket_id}})
    for payment in payments:
        timeline.append({"at": _iso(payment.created_at), "kind": "payment", "title": "Payment ledger event", "meta": {"workspace_id": payment.workspace_id, "provider": payment.provider, "plan": payment.plan, "status": payment.status, "currency": payment.currency, "amount_minor": payment.amount_minor, "fiscal_status": payment.fiscal_status, "is_test": bool(payment.is_test)}})
    for event in audit:
        if event.event_type in {SUPPORT_NOTE_EVENT, FEATURE_FLAG_EVENT, ANNOUNCEMENT_EVENT, CHECKLIST_EVENT}:
            continue
        timeline.append({"at": _iso(event.created_at), "kind": "audit", "title": event.event_type, "meta": {"workspace_id": event.workspace_id, "project_id": event.project_id}})
    timeline.sort(key=lambda item: item.get("at") or "", reverse=True)

    return {
        "customer": {
            "id": target.id,
            "email": target.email,
            "is_active": bool(target.is_active),
            "created_at": _iso(target.created_at),
            "terms_version": target.terms_version,
            "privacy_version": target.privacy_version,
        },
        "workspaces": [
            {
                "id": item.id,
                "name": item.name,
                "tier": item.subscription_tier,
                "subscription_status": item.subscription_status,
                "billing_provider": item.billing_provider,
                "period_end": _iso(item.current_period_end),
                "is_lifetime_free": bool(item.is_lifetime_free),
            }
            for item in workspaces
        ],
        "projects": [{"id": item.id, "workspace_id": item.workspace_id, "slug": item.slug, "name": item.name, "telemetry_enabled": bool(item.telemetry_enabled), "runtime_error_tracking_enabled": bool(item.runtime_error_tracking_enabled)} for item in projects],
        "timeline": timeline[:250],
    }


@router.get("/founder/customers/{user_id}/timeline")
async def founder_customer_timeline(
    user_id: str,
    _admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    target = await _target_user(db, user_id)
    return await _customer_timeline(db, target)


@router.get("/founder/customers/{user_id}/support")
async def founder_customer_support(
    user_id: str,
    _admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    await _target_user(db, user_id)
    notes: list[dict[str, Any]] = []
    for event in reversed(await _events(db, SUPPORT_NOTE_EVENT)):
        details = dict(event.details or {})
        if details.get("target_user_id") != user_id:
            continue
        notes.append({**details, "id": event.id, "created_at": _iso(event.created_at), "author_user_id": event.user_id})
    return {"notes": notes[:200]}


@router.post("/founder/customers/{user_id}/support")
async def founder_add_support_note(
    user_id: str,
    payload: SupportNoteCreate,
    admin: models.User = Depends(control_router.require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    await _target_user(db, user_id)
    details = {"target_user_id": user_id, "note": payload.note.strip(), "tags": _clean_tags(payload.tags)}
    event = await _append_event(db, admin, SUPPORT_NOTE_EVENT, details)
    return {**details, "id": event.id, "created_at": _iso(event.created_at)}


async def _error_center(db: AsyncSession, limit: int = 100) -> list[dict[str, Any]]:
    rows = list((await db.execute(
        select(models.ErrorGroup, models.Project)
        .join(models.Project, models.Project.id == models.ErrorGroup.project_id)
        .where(models.Project.is_deleted == False)
        .order_by(models.ErrorGroup.last_seen_at.desc())
        .limit(limit)
    )).all())
    return [
        {
            "id": group.id,
            "project_id": project.id,
            "project_slug": project.slug,
            "workspace_id": project.workspace_id,
            "service": group.service,
            "exception_type": group.exception_type,
            "message": group.normalized_message,
            "route": group.route,
            "status": group.status,
            "occurrences": group.occurrences_count,
            "first_seen_at": _iso(group.first_seen_at),
            "last_seen_at": _iso(group.last_seen_at),
            "ticket_id": group.ticket_id,
        }
        for group, project in rows
    ]


@router.get("/founder/errors")
async def founder_error_center(
    limit: int = Query(default=100, ge=1, le=500),
    _admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    errors = await _error_center(db, limit)
    return {
        "errors": errors,
        "counts": {
            "open": sum(1 for item in errors if item["status"] == "open"),
            "resolved": sum(1 for item in errors if item["status"] == "resolved"),
            "ignored": sum(1 for item in errors if item["status"] == "ignored"),
        },
        "read_only": True,
    }


async def _reconciliation(db: AsyncSession) -> dict[str, Any]:
    now = models.utcnow()
    workspaces = list((await db.execute(select(models.Workspace))).scalars().all())
    payments = list((await db.execute(
        select(models.Payment).where(models.Payment.is_test == False).order_by(models.Payment.created_at.asc())
    )).scalars().all())
    by_workspace: dict[str, list[models.Payment]] = defaultdict(list)
    for payment in payments:
        by_workspace[payment.workspace_id].append(payment)

    issues: list[dict[str, Any]] = []
    for workspace in workspaces:
        ledger = by_workspace.get(workspace.id, [])
        succeeded = [item for item in ledger if item.status == "succeeded"]
        latest = succeeded[-1] if succeeded else None
        old_pending = [item for item in ledger if item.status == "pending" and item.created_at and item.created_at <= now - timedelta(minutes=15)]
        fiscal = [item for item in ledger if item.fiscal_status in {"receipt_required", "receipt_refund_required"}]
        if old_pending:
            issues.append({"severity": "high", "workspace_id": workspace.id, "kind": "stale_pending", "detail": f"{len(old_pending)} real payment(s) pending longer than 15 minutes."})
        if fiscal:
            issues.append({"severity": "high", "workspace_id": workspace.id, "kind": "fiscal_attention", "detail": f"{len(fiscal)} payment(s) require fiscal follow-up."})
        paid_tier = str(workspace.subscription_tier or "free") not in {"", "free"}
        exception_entitlement = bool(workspace.is_lifetime_free or workspace.promo_code_used)
        if paid_tier and workspace.subscription_status == "active" and latest is None and not exception_entitlement:
            issues.append({"severity": "medium", "workspace_id": workspace.id, "kind": "active_without_payment", "detail": "Active paid entitlement has no succeeded real payment and no visible promo/lifetime provenance."})
        if latest and latest.entitlement_period_end and workspace.current_period_end:
            drift = abs((workspace.current_period_end - latest.entitlement_period_end).total_seconds())
            if drift > 300 and workspace.subscription_status == "active":
                issues.append({"severity": "medium", "workspace_id": workspace.id, "kind": "period_drift", "detail": "Workspace current_period_end differs from latest succeeded payment entitlement by more than 5 minutes."})
    return {
        "issues": issues,
        "summary": {
            "workspaces": len(workspaces),
            "real_payments": len(payments),
            "high": sum(1 for item in issues if item["severity"] == "high"),
            "medium": sum(1 for item in issues if item["severity"] == "medium"),
        },
        "provider_truth_checked": False,
        "note": "This is local invariant reconciliation only. Remote provider truth must come from the approved provider adapter/webhook/reconciliation API.",
    }


@router.get("/founder/reconciliation")
async def founder_reconciliation(
    _admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    return await _reconciliation(db)


async def _privacy_requests(db: AsyncSession) -> list[dict[str, Any]]:
    state = await _latest_records(db, PRIVACY_REQUEST_EVENT, "request_id")
    return sorted(state.values(), key=lambda item: item.get("updated_at") or item.get("created_at") or "", reverse=True)


@router.get("/founder/privacy-requests")
async def founder_privacy_requests(
    _admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    return {"requests": await _privacy_requests(db), "destructive_execution_available": False}


@router.post("/founder/privacy-requests")
async def founder_create_privacy_request(
    payload: PrivacyRequestCreate,
    admin: models.User = Depends(control_router.require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    await _target_user(db, payload.user_id)
    request_id = f"dsr_{uuid.uuid4().hex[:12]}"
    now = models.utcnow()
    details = {
        "request_id": request_id,
        "target_user_id": payload.user_id,
        "request_type": payload.request_type,
        "status": "open",
        "reason": payload.reason.strip(),
        "created_at": _iso(now),
        "note": "",
    }
    event = await _append_event(db, admin, PRIVACY_REQUEST_EVENT, details)
    return {**details, "updated_at": _iso(event.created_at)}


@router.patch("/founder/privacy-requests/{request_id}")
async def founder_update_privacy_request(
    request_id: str,
    payload: PrivacyRequestUpdate,
    admin: models.User = Depends(control_router.require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    state = await _latest_records(db, PRIVACY_REQUEST_EVENT, "request_id")
    current = state.get(request_id)
    if not current:
        raise HTTPException(status_code=404, detail="Privacy request not found")
    details = {**current, "status": payload.status, "note": payload.note.strip()}
    details.pop("updated_at", None)
    event = await _append_event(db, admin, PRIVACY_REQUEST_EVENT, details)
    return {**details, "updated_at": _iso(event.created_at)}


@router.get("/founder/privacy-requests/{request_id}/preview")
async def founder_privacy_request_preview(
    request_id: str,
    _admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    state = await _latest_records(db, PRIVACY_REQUEST_EVENT, "request_id")
    current = state.get(request_id)
    if not current:
        raise HTTPException(status_code=404, detail="Privacy request not found")
    target = await _target_user(db, current["target_user_id"])
    timeline = await _customer_timeline(db, target)
    return {
        "request": current,
        "data_manifest": {
            "user_fields": ["email", "account status", "legal-consent versions", "created_at"],
            "workspace_count": len(timeline["workspaces"]),
            "project_count": len(timeline["projects"]),
            "timeline_event_count": len(timeline["timeline"]),
        },
        "execution": "preview_only",
        "retention_review_required": current["request_type"] in {"delete", "anonymize"},
    }


async def _cohorts(db: AsyncSession, weeks: int = 8) -> dict[str, Any]:
    now = models.utcnow()
    start = now - timedelta(days=weeks * 7)
    users = list((await db.execute(
        select(models.User.id, models.User.email, models.User.created_at)
        .where(models.User.created_at >= start)
    )).all())
    owner_emails = [str(row[1]).lower() for row in users]
    workspaces = list((await db.execute(
        select(models.Workspace).where(func.lower(models.Workspace.owner_email).in_(owner_emails))
    )).scalars().all()) if owner_emails else []
    ws_by_email: dict[str, list[models.Workspace]] = defaultdict(list)
    for workspace in workspaces:
        ws_by_email[str(workspace.owner_email or "").lower()].append(workspace)
    workspace_ids = [item.id for item in workspaces]
    projects = list((await db.execute(
        select(models.Project).where(models.Project.workspace_id.in_(workspace_ids), models.Project.is_deleted == False)
    )).scalars().all()) if workspace_ids else []
    projects_by_ws: dict[str, list[models.Project]] = defaultdict(list)
    for project in projects:
        projects_by_ws[project.workspace_id].append(project)
    paid_ws = set((await db.execute(
        select(models.Payment.workspace_id)
        .where(
            models.Payment.workspace_id.in_(workspace_ids),
            models.Payment.status == "succeeded",
            models.Payment.is_test == False,
        ).distinct()
    )).scalars().all()) if workspace_ids else set()

    grouped: dict[str, dict[str, Any]] = {}
    activated_30d = 0
    paid_30d = 0
    signups_30d = 0
    thirty = now - timedelta(days=30)
    for user_id, email, created_at in users:
        monday = (created_at - timedelta(days=created_at.weekday())).date().isoformat()
        bucket = grouped.setdefault(monday, {"week": monday, "signups": 0, "activated_24h": 0, "paid": 0})
        bucket["signups"] += 1
        owned = ws_by_email.get(str(email).lower(), [])
        activated = any(
            project.created_at and created_at <= project.created_at <= created_at + timedelta(hours=24)
            for workspace in owned
            for project in projects_by_ws.get(workspace.id, [])
        )
        paid = any(workspace.id in paid_ws for workspace in owned)
        if activated:
            bucket["activated_24h"] += 1
        if paid:
            bucket["paid"] += 1
        if created_at >= thirty:
            signups_30d += 1
            activated_30d += int(activated)
            paid_30d += int(paid)

    cohorts = []
    for key in sorted(grouped):
        bucket = grouped[key]
        signups = bucket["signups"]
        cohorts.append({
            **bucket,
            "activation_pct": round(bucket["activated_24h"] / signups * 100, 1) if signups else None,
            "paid_pct": round(bucket["paid"] / signups * 100, 1) if signups else None,
        })
    return {
        "cohorts": cohorts,
        "funnel_30d": {
            "landing_visits": None,
            "signups": signups_30d,
            "activated_24h": activated_30d,
            "paid_users": paid_30d,
            "landing_denominator_instrumented": False,
        },
        "note": "Cohorts use workspace owner email to avoid counting invited team members as founder acquisition. Landing denominator remains explicitly unavailable until first-party page-view attribution is instrumented.",
    }


@router.get("/founder/cohorts")
async def founder_cohorts(
    weeks: int = Query(default=8, ge=2, le=26),
    _admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    return await _cohorts(db, weeks)


async def _feature_flags(db: AsyncSession) -> list[dict[str, Any]]:
    state = await _latest_records(db, FEATURE_FLAG_EVENT, "key")
    return sorted(state.values(), key=lambda item: item.get("key", ""))


@router.get("/founder/feature-flags")
async def founder_feature_flags(
    _admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    return {"flags": await _feature_flags(db)}


@router.post("/founder/feature-flags")
async def founder_save_feature_flag(
    payload: FeatureFlagUpsert,
    admin: models.User = Depends(control_router.require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    details = {
        "key": payload.key,
        "description": payload.description.strip(),
        "enabled": bool(payload.enabled),
        "rollout_pct": int(payload.rollout_pct),
        "workspace_ids": list(dict.fromkeys(payload.workspace_ids))[:100],
        "expires_at": _iso(payload.expires_at),
    }
    event = await _append_event(db, admin, FEATURE_FLAG_EVENT, details)
    return {**details, "updated_at": _iso(event.created_at)}


def _flag_enabled(flag: dict[str, Any], user_id: str, workspace_id: str | None, now: datetime) -> bool:
    if not flag.get("enabled"):
        return False
    expires_raw = flag.get("expires_at")
    if expires_raw:
        try:
            expires = datetime.fromisoformat(str(expires_raw).replace("Z", "+00:00")).replace(tzinfo=None)
            if expires <= now:
                return False
        except ValueError:
            return False
    allowed = [str(item) for item in (flag.get("workspace_ids") or []) if item]
    if allowed and (not workspace_id or workspace_id not in allowed):
        return False
    rollout = max(0, min(100, int(flag.get("rollout_pct") or 0)))
    if rollout >= 100:
        return True
    if rollout <= 0:
        return False
    digest = hashlib.sha256(f"{flag.get('key')}:{user_id}".encode("utf-8")).digest()
    bucket = int.from_bytes(digest[:4], "big") % 100
    return bucket < rollout


@runtime_router.get("/api/feature-flags")
async def runtime_feature_flags(
    workspace_id: str | None = Query(default=None),
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if workspace_id:
        await auth.require_workspace_capability(workspace_id, "workspace:read", user, db)
    now = models.utcnow()
    flags = await _feature_flags(db)
    return {
        "flags": {flag["key"]: _flag_enabled(flag, user.id, workspace_id, now) for flag in flags},
        "evaluated_at": _iso(now),
    }


async def _announcements(db: AsyncSession) -> list[dict[str, Any]]:
    state = await _latest_records(db, ANNOUNCEMENT_EVENT, "announcement_id")
    return sorted(state.values(), key=lambda item: item.get("updated_at") or "", reverse=True)


@router.get("/founder/announcements")
async def founder_announcements(
    _admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    return {"announcements": await _announcements(db)}


@router.post("/founder/announcements")
async def founder_save_announcement(
    payload: AnnouncementUpsert,
    admin: models.User = Depends(control_router.require_elevated_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    announcement_id = payload.announcement_id or f"ann_{uuid.uuid4().hex[:12]}"
    tiers = [tier for tier in dict.fromkeys(str(item).strip().lower() for item in payload.tiers) if tier in {"free", "solo", "studio", "business"}]
    details = {
        "announcement_id": announcement_id,
        "title": payload.title.strip(),
        "body": payload.body.strip(),
        "active": bool(payload.active),
        "tiers": tiers,
        "workspace_ids": list(dict.fromkeys(payload.workspace_ids))[:100],
        "starts_at": _iso(payload.starts_at),
        "ends_at": _iso(payload.ends_at),
    }
    event = await _append_event(db, admin, ANNOUNCEMENT_EVENT, details)
    return {**details, "updated_at": _iso(event.created_at)}


def _announcement_visible(item: dict[str, Any], workspace: models.Workspace | None, now: datetime) -> bool:
    if not item.get("active"):
        return False
    for field, comparator in (("starts_at", "after"), ("ends_at", "before")):
        raw = item.get(field)
        if not raw:
            continue
        try:
            value = datetime.fromisoformat(str(raw).replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return False
        if comparator == "after" and now < value:
            return False
        if comparator == "before" and now >= value:
            return False
    ws_ids = [str(value) for value in (item.get("workspace_ids") or []) if value]
    if ws_ids and (workspace is None or workspace.id not in ws_ids):
        return False
    tiers = [str(value).lower() for value in (item.get("tiers") or []) if value]
    if tiers and (workspace is None or str(workspace.subscription_tier or "free").lower() not in tiers):
        return False
    return True


@runtime_router.get("/api/announcements")
async def runtime_announcements(
    workspace_id: str | None = Query(default=None),
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    workspace = None
    if workspace_id:
        workspace = await auth.require_workspace_capability(workspace_id, "workspace:read", user, db)
    now = models.utcnow()
    visible = [item for item in await _announcements(db) if _announcement_visible(item, workspace, now)]
    return {
        "announcements": [
            {"id": item["announcement_id"], "title": item["title"], "body": item["body"], "updated_at": item.get("updated_at")}
            for item in visible
        ],
        "evaluated_at": _iso(now),
    }


async def _diagnostic_snapshot(db: AsyncSession, target: models.User) -> dict[str, Any]:
    timeline = await _customer_timeline(db, target)
    workspace_ids = [item["id"] for item in timeline["workspaces"]]
    project_ids = [item["id"] for item in timeline["projects"]]
    sessions = int((await db.execute(
        select(func.count(models.Session.id)).where(
            models.Session.user_id == target.id,
            models.Session.revoked_at.is_(None),
            models.Session.expires_at > models.utcnow(),
        )
    )).scalar() or 0)
    payments = int((await db.execute(
        select(func.count(models.Payment.id)).where(models.Payment.workspace_id.in_(workspace_ids))
    )).scalar() or 0) if workspace_ids else 0
    feedback = int((await db.execute(
        select(func.count(models.Feedback.id)).where(models.Feedback.project_id.in_(project_ids))
    )).scalar() or 0) if project_ids else 0
    errors = int((await db.execute(
        select(func.count(models.ErrorGroup.id)).where(models.ErrorGroup.project_id.in_(project_ids), models.ErrorGroup.status == "open")
    )).scalar() or 0) if project_ids else 0
    return {
        "mode": "read_only_diagnostic",
        "impersonation": False,
        "session_minted": False,
        "customer": timeline["customer"],
        "workspaces": timeline["workspaces"],
        "projects": timeline["projects"],
        "counts": {"active_sessions": sessions, "payments": payments, "feedback": feedback, "open_error_groups": errors},
        "safety": "No customer bearer/session/cookie is created. This surface is a sanitized founder diagnostic only.",
    }


@router.get("/founder/diagnostic/customers/{user_id}")
async def founder_customer_diagnostic(
    user_id: str,
    _admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    return await _diagnostic_snapshot(db, await _target_user(db, user_id))


@router.get("/founder/capabilities")
async def founder_capabilities(
    _admin: models.User = Depends(control_router.require_platform_admin),
):
    return {
        "capabilities": list(CAPABILITY_STATUS),
        "rule": "Implemented means a real first-party read/write path exists. External/security dependencies stay explicitly blocked instead of exposing fake mutations.",
    }


@router.get("/founder/shortcuts")
async def founder_shortcuts(
    _admin: models.User = Depends(control_router.require_platform_admin),
):
    return {
        "shortcuts": [
            {"label": "Product Radar", "href": "/control"},
            {"label": "Founder Workbench", "href": "/control/workbench"},
            {"label": "Operations Console", "href": "/control/ops"},
            {"label": "Live AI brief (Markdown)", "href": "/api/control/briefing.md"},
            {"label": "Account", "href": "/app"},
            {"label": "GitHub repository", "href": "https://github.com/AlexeyPlaton/VibeUs"},
        ]
    }


def _md(value: Any) -> str:
    if value is None:
        return "—"
    return str(value).replace("|", "\\|").replace("\r", " ").replace("\n", " ").strip()


async def _briefing_payload(db: AsyncSession, admin: models.User) -> dict[str, Any]:
    radar = await product_radar.product_radar(user=admin, db=db)
    checklist = await _launch_checklist(db)
    reconciliation = await _reconciliation(db)
    capabilities = list(CAPABILITY_STATUS)
    return {
        "generated_at": _iso(models.utcnow()),
        "privacy": {
            "pii_included": False,
            "customer_free_form_content_included": False,
            "secrets_included": False,
            "note": "Founder AI brief intentionally contains product aggregates and operating state, not customer content or credentials.",
        },
        "radar": radar,
        "launch_checklist": {
            "items": [{"key": item["key"], "group": item["group"], "channel": item["channel"], "status": item["status"], "link": item.get("link", ""), "success_signal": item["success_signal"]} for item in checklist],
            "published": sum(1 for item in checklist if item["status"] == "published"),
            "preparing": sum(1 for item in checklist if item["status"] == "preparing"),
            "total": len(checklist),
        },
        "reconciliation": reconciliation,
        "capabilities": capabilities,
    }


def _render_briefing_markdown(payload: dict[str, Any]) -> str:
    radar = payload["radar"]
    checklist = payload["launch_checklist"]
    reconciliation = payload["reconciliation"]
    lines = [
        "# VibeUs Founder AI Brief",
        "",
        f"Generated: `{_md(payload['generated_at'])}`",
        "",
        "> Private founder operating brief. It intentionally excludes customer free-form content, credentials and secrets.",
        "",
        "## Instructions for the AI strategist",
        "",
        "- Treat low-confidence / insufficient-sample signals as a request for more evidence, not as proof that the product is bad.",
        "- Protect money, fiscal correctness, legal consent and trust before recommending growth spend.",
        "- Prefer activation, first value and repeat value before scaling top-of-funnel acquisition.",
        "- Do not infer payment-provider approval, geography or recurring-payment support from a configuration flag.",
        "- Separate VibeUs platform reliability from runtime errors captured in customer projects.",
        "- Recommend the smallest high-leverage experiment and state which metric should move if the hypothesis is correct.",
        "",
        "## North Star",
        "",
        f"**{_md(radar.get('north_star', {}).get('name', 'Weekly Value Workspaces'))}: {_md(radar.get('north_star', {}).get('value'))}**",
        f"Previous: {_md(radar.get('north_star', {}).get('previous'))}; change: {_md(radar.get('north_star', {}).get('change_pct'))}% ; confidence: {_md(radar.get('north_star', {}).get('confidence'))}.",
        "",
        "## Steering radar",
        "",
        "| Dimension | Status | Value | Unit | Score | Confidence | Sample | Trend | Target |",
        "|---|---|---:|---|---:|---|---:|---:|---|",
    ]
    for item in radar.get("dimensions", []):
        lines.append(
            f"| {_md(item.get('label'))} | {_md(item.get('status'))} | {_md(item.get('value'))} | {_md(item.get('unit'))} | {_md(item.get('score'))} | {_md(item.get('confidence'))} | {_md(item.get('sample'))} | {_md(item.get('trend_pct'))} | {_md(item.get('target'))} |"
        )
    lines += ["", "## Steering Queue", ""]
    for item in radar.get("steering_queue", []):
        lines.append(f"- **{_md(item.get('priority'))} · {_md(item.get('area'))}: {_md(item.get('title'))}** — {_md(item.get('reason'))} Action: {_md(item.get('action'))} Guardrail: {_md(item.get('guardrail'))}")
    if not radar.get("steering_queue"):
        lines.append("- No steering intervention generated from current signals.")

    lines += ["", "## Value loop · current 7d", "", "| Step | Value | Unit |", "|---|---:|---|"]
    for item in radar.get("value_loop", []):
        lines.append(f"| {_md(item.get('label'))} | {_md(item.get('value'))} | {_md(item.get('unit'))} |")

    lines += ["", "## Launch guardrails", ""]
    for item in radar.get("guardrails", []):
        lines.append(f"- **{_md(item.get('label'))}: {_md(item.get('status'))}** — {_md(item.get('detail'))}")

    coverage = radar.get("data_coverage", {})
    lines += [
        "",
        "## Instrumentation confidence",
        "",
        f"Measured steering coverage: **{_md(coverage.get('pct'))}%** ({_md(coverage.get('measured'))}/{_md(coverage.get('total'))}).",
        "",
    ]
    for gap in coverage.get("gaps", []):
        lines.append(f"- **{_md(gap.get('label'))}** — {_md(gap.get('why'))} Next: {_md(gap.get('next'))}")

    lines += [
        "",
        "## Launch distribution checklist",
        "",
        f"Published: **{checklist['published']}/{checklist['total']}**; preparing: **{checklist['preparing']}**.",
        "",
        "| Group | Channel | State | Published link | Success signal |",
        "|---|---|---|---|---|",
    ]
    for item in checklist["items"]:
        lines.append(f"| {_md(item['group'])} | {_md(item['channel'])} | {_md(item['status'])} | {_md(item.get('link'))} | {_md(item.get('success_signal'))} |")

    lines += [
        "",
        "## Money / ledger reconciliation",
        "",
        f"High-severity local issues: **{reconciliation['summary']['high']}**; medium: **{reconciliation['summary']['medium']}**.",
        "",
    ]
    for issue in reconciliation.get("issues", [])[:50]:
        lines.append(f"- **{_md(issue['severity'])} · {_md(issue['kind'])} · workspace {_md(issue['workspace_id'])}** — {_md(issue['detail'])}")
    lines += [
        "",
        f"> {_md(reconciliation['note'])}",
        "",
        "## Founder-control capabilities",
        "",
    ]
    for item in payload["capabilities"]:
        lines.append(f"- **{_md(item['key'])}: {_md(item['status'])}** — {_md(item['detail'])}")
    lines += [
        "",
        "## Suggested response format for an AI review",
        "",
        "1. Current diagnosis in 3–5 sentences.",
        "2. The single most important steering decision now, with evidence and confidence.",
        "3. What NOT to optimize yet.",
        "4. One primary experiment and one fallback experiment, each with metric, threshold and review window.",
        "5. Any data gap that makes the recommendation unsafe or premature.",
        "",
    ]
    return "\n".join(lines)


@router.get("/briefing.json")
async def founder_briefing_json(
    admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    return await _briefing_payload(db, admin)


@router.get("/briefing.md")
@router.get("/radar.md")
async def founder_briefing_markdown(
    admin: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    payload = await _briefing_payload(db, admin)
    return Response(
        content=_render_briefing_markdown(payload),
        media_type="text/markdown; charset=utf-8",
        headers={"Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow"},
    )
