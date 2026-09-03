import models
from dotenv import load_dotenv
load_dotenv()
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, Request, Response, Query, Header, Body, status
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, List, Optional, Any
import json
import os
import asyncio
import logging
import hashlib

logger = logging.getLogger("vibeus.api")

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

import database
from database import get_db, async_session, engine
from models import Base, Project
import crud
import security
import telegram_service
import github_service
import schemas
import entitlements
import error_bridge
import pricing
from tunnel import tunnel_gateway, MAX_TUNNEL_WS_FRAME_BYTES
from schemas import (
    WorkspaceCreate,
    WorkspaceResponse,
    RedeemPromoRequest,
    ProjectCreate, 
    ProjectResponse, 
    ProjectCreateResponse,
    FeedbackCreate,
    NodeCreate, 
    TicketCreate, 
    TicketUpdate, 
    BoardResponse
)
from auth import get_project_by_token, get_project_public
import auth
from urllib.parse import urlsplit
from datetime import datetime, timezone

is_test_env = os.getenv("ENVIRONMENT") == "test" or os.getenv("ENV") == "test" or os.getenv("TESTING") == "true"
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"], enabled=not is_test_env)


from criteria_evidence import (
    criteria_auto_review_ready as _criteria_auto_review_ready,
    criteria_contract_fingerprint,
    sign_criteria_receipt as _sign_criteria_receipt,
    validated_machine_receipt,
    validated_machine_receipt as _validated_criteria_receipt,
)
# V6.1 compatibility marker: evidence receipt digest mismatch is enforced in criteria_evidence.py.


async def _verify_widget_build_artifacts_for_production() -> None:
    """Fail closed if the deploy contains a stale/missing embedded widget build."""
    import hashlib
    manifest_path = os.path.join(os.path.dirname(__file__), "static", "widget-build-manifest.json")
    if not os.path.exists(manifest_path):
        raise RuntimeError(
            "Production widget build manifest is missing. Run `npm ci && npm run build:widget` in openspec-web before deployment."
        )
    try:
        with open(manifest_path, "r", encoding="utf-8") as fh:
            manifest = json.load(fh)
    except Exception as exc:
        raise RuntimeError("Production widget build manifest is unreadable") from exc

    for name in ("vibus-widget.umd.cjs", "vibus-widget.css"):
        expected = (manifest.get("files") or {}).get(name) or {}
        artifact_path = os.path.join(os.path.dirname(__file__), "static", name)
        if not os.path.exists(artifact_path):
            raise RuntimeError(f"Production widget artifact is missing: {name}")
        with open(artifact_path, "rb") as fh:
            data = fh.read()
        digest = hashlib.sha256(data).hexdigest()
        if len(data) < 256 or digest != expected.get("sha256") or len(data) != expected.get("bytes"):
            raise RuntimeError(
                f"Production widget artifact failed manifest verification: {name}. Rebuild the widget before deployment."
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    from settings import get_settings
    runtime_settings = get_settings()
    if runtime_settings.environment == "production":
        await _verify_widget_build_artifacts_for_production()

    # Development-only convenience. Production refuses ENABLE_DEMO_SEED=true
    # and must provision its demo project/key explicitly so the public widget
    # credential is known, reviewable and origin-restricted.
    if runtime_settings.enable_demo_seed:
        try:
            async with async_session() as db:
                project = await crud.get_project_by_slug(db, "demo-showcase")
                if not project:
                    demo_workspace = await crud.get_or_create_workspace(
                        db,
                        owner_email="demo@vibeus.pro",
                        name="VibeUs Demo Workspace",
                    )
                    project, _, raw_public_key, _ = await crud.create_project(
                        db,
                        ProjectCreate(
                            name="Nexus CRM Demo",
                            slug="demo-showcase",
                            workspace_id=demo_workspace.id,
                            public_widget_origins=["http://localhost:5173", "http://localhost:3000"],
                        ),
                        workspace=demo_workspace,
                    )
                    logger.warning(
                        "Development demo created. Set VITE_DEMO_PUBLIC_WIDGET_KEY=%s in openspec-web/.env.local",
                        raw_public_key,
                    )

                    spec_content = "> Добро пожаловать в Nexus CRM!\n\nЗагрузи свои спецификации через `vibus push`, чтобы они появились здесь."
                    try:
                        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                        spec_path = os.path.join(base_dir, 'docs', 'SPEC.md')
                        if os.path.exists(spec_path):
                            with open(spec_path, 'r', encoding='utf-8') as f:
                                spec_content = f.read()
                    except Exception as exc:
                        logger.error("Error reading demo spec: %s", exc)

                    await crud.create_node(
                        db,
                        project.id,
                        NodeCreate(
                            title="Техническое Задание (ТЗ)",
                            content_markdown=spec_content,
                            parent_id=None,
                        ),
                    )
        except Exception as exc:
            logger.warning("Demo seeding bypassed: %s", exc)

    yield

import uuid
import re
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from pydantic import ValidationError

app = FastAPI(title='Vibus Cloud API', version='1.0.0', lifespan=lifespan)
app.state.limiter = limiter

from settings import get_settings
settings = get_settings()

CORS_ORIGINS = settings.cors_origins
MAX_HTTP_BODY_BYTES = 1024 * 1024  # 1 MB limit

@app.middleware("http")
async def request_middleware(request: Request, call_next):
    # 🔒 Authoritative Server Request ID: Always generated by VibeUs server
    server_request_id = uuid.uuid4().hex

    # Client-supplied correlation identifier is tracked and sanitized separately
    raw_correlation = request.headers.get("x-request-id") or request.headers.get("x-correlation-id")
    client_correlation_id = None
    if raw_correlation:
        cleaned = re.sub(r"[^a-zA-Z0-9_-]", "", raw_correlation.strip()[:64])
        if len(cleaned) >= 8:
            client_correlation_id = cleaned

    request_id = server_request_id
    request.state.request_id = server_request_id
    request.state.client_correlation_id = client_correlation_id

    # Cookie-authenticated browser mutations need an explicit same-origin
    # signal. Bearer/API clients are not subject to this check because they do
    # not rely on ambient browser credentials.
    if request.method.upper() not in {"GET", "HEAD", "OPTIONS"}:
        browser_cookie = request.cookies.get(settings.browser_session_cookie_name)
        preview_cookie = request.cookies.get(settings.preview_session_cookie_name)
        explicit_bearer = (request.headers.get("authorization") or "").lower().startswith("bearer ")
        if (browser_cookie or preview_cookie) and not explicit_bearer:
            origin = (request.headers.get("origin") or "").rstrip("/")
            trusted_origins: set[str] = set()
            for raw in [settings.public_base_url, settings.preview_base_url]:
                if raw:
                    trusted_origins.add(str(raw).rstrip("/"))
            if isinstance(settings.cors_origins, str):
                trusted_origins.update(p.strip().rstrip("/") for p in settings.cors_origins.split(",") if p.strip())
            elif isinstance(settings.cors_origins, (list, tuple, set)):
                for item in settings.cors_origins:
                    trusted_origins.update(p.strip().rstrip("/") for p in str(item).split(",") if p.strip())
            if settings.environment in {"development", "test"}:
                trusted_origins.update({"http://localhost:8000", "http://127.0.0.1:8000", "http://localhost:5173", "http://localhost:3000"})
            if not origin or origin not in trusted_origins:
                return JSONResponse(
                    status_code=403,
                    content={
                        "detail": "Untrusted or missing Origin for cookie-authenticated mutation",
                        "error": {
                            "code": "CSRF_ORIGIN_REJECTED",
                            "message": "Untrusted or missing Origin for cookie-authenticated mutation",
                            "request_id": request_id,
                        }
                    },
                    headers={"X-Request-ID": request_id},
                )

    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_HTTP_BODY_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={
                        "error": {
                            "code": "PAYLOAD_TOO_LARGE",
                            "message": "Request payload too large",
                            "request_id": request_id,
                        }
                    },
                    headers={"X-Request-ID": request_id},
                )
        except ValueError:
            pass

    response = await call_next(request)
    response.headers["X-Request-ID"] = server_request_id
    if client_correlation_id:
        response.headers["X-Client-Correlation-ID"] = client_correlation_id
    return response

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
    code_map = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        402: "PAYMENT_REQUIRED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        413: "PAYLOAD_TOO_LARGE",
        422: "VALIDATION_ERROR",
        429: "RATE_LIMITED",
        500: "INTERNAL_SERVER_ERROR",
        502: "BAD_GATEWAY",
        503: "SERVICE_UNAVAILABLE",
    }
    code = code_map.get(exc.status_code, "ERROR")
    headers = dict(getattr(exc, "headers", None) or {})
    headers["X-Request-ID"] = request_id
    return JSONResponse(
        status_code=exc.status_code,
        content={
            # Keep FastAPI's familiar top-level detail during the transition to
            # the structured error envelope. Existing clients already read it.
            "detail": str(exc.detail),
            "error": {
                "code": code,
                "message": str(exc.detail),
                "request_id": request_id,
            }
        },
        headers=headers,
    )

def _sanitize_validation_errors(errors):
    sanitized = []
    for err in errors:
        e_copy = dict(err)
        e_copy.pop("input", None)
        if "ctx" in e_copy and isinstance(e_copy["ctx"], dict):
            e_copy["ctx"] = {k: str(v) for k, v in e_copy["ctx"].items()}
        sanitized.append(e_copy)
    return sanitized

@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
    safe_errors = jsonable_encoder(_sanitize_validation_errors(exc.errors()))
    return JSONResponse(
        status_code=422,
        content={
            "detail": safe_errors,
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "request_id": request_id,
                "fields": safe_errors,
            },
        },
        headers={"X-Request-ID": request_id},
    )

@app.exception_handler(ValidationError)
async def pydantic_validation_exception_handler(request: Request, exc: ValidationError):
    request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
    safe_errors = jsonable_encoder(_sanitize_validation_errors(exc.errors()))
    return JSONResponse(
        status_code=422,
        content={
            "detail": safe_errors,
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Validation failed",
                "request_id": request_id,
                "fields": safe_errors,
            },
        },
        headers={"X-Request-ID": request_id},
    )

@app.exception_handler(RateLimitExceeded)
async def custom_rate_limit_handler(request: Request, exc: RateLimitExceeded):
    request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Too many requests. Please try again later.",
            "error": {
                "code": "RATE_LIMITED",
                "message": "Too many requests. Please try again later.",
                "request_id": request_id,
            }
        },
        headers={"Retry-After": "60", "X-Request-ID": request_id},
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
    logger.error(f"Unhandled exception [req_id={request_id}]: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "An unexpected error occurred",
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred",
                "request_id": request_id,
            }
        },
        headers={"X-Request-ID": request_id},
    )

# Cross-origin browser widgets must not depend on ambient SaaS cookies.
# In production-like environments the account UI/API are required to be
# same-origin, while embedded widgets/API clients authenticate explicitly via
# X-Vibus-Public-Key / Bearer / access-link credentials. Endpoint-level origin
# policies still enforce each project's public_widget_origins allow-list.
_is_production_like = settings.environment in {"production", "staging", "quality_gate"}
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _is_production_like else CORS_ORIGINS,
    allow_credentials=not _is_production_like,
    allow_methods=['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allow_headers=['*'],
    expose_headers=['X-Request-ID'],
    max_age=600,
)

# Health check
@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'Vibus Cloud'}

@app.get('/api/public/pricing')
def public_pricing():
    return pricing.public_catalog()

@app.get('/ready')
async def readiness_check(db: AsyncSession = Depends(get_db)):
    try:
        from sqlalchemy import text
        await db.execute(text("SELECT 1"))
        return {"status": "ready", "checks": {"database": "ok"}}
    except Exception as e:
        logger.error(f"Readiness check failed: {e}")
        return JSONResponse(status_code=503, content={"status": "unavailable", "checks": {"database": "failed"}})

@app.get('/version')
def version():
    return {'version': '2.4.0', 'environment': settings.environment}

@app.get('/')
def read_root():
    return {"status": "Vibus Cloud is running", "version": "2.4.0", "docs": "/docs"}

from security import get_password_hash, verify_password, create_access_token
from models import User, Session, WorkspaceMembership, Workspace, AuditEvent
from sqlalchemy import select, func
from datetime import datetime, timezone, timedelta
from auth import get_current_user, require_workspace_capability, oauth2_scheme

# === AUTH ENDPOINTS ===

@app.get('/api/auth/me', response_model=schemas.UserResponse)
async def auth_me(current_user: User = Depends(get_current_user)):
    return current_user

@app.post('/api/auth/register', response_model=schemas.UserResponse)
@limiter.limit("10/minute")
async def register_user(request: Request, user_data: schemas.UserCreate, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(models.User).where(models.User.email == user_data.email))
    if res.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")
        
    user = models.User(
        email=user_data.email,
        hashed_password=security.get_password_hash(user_data.password),
        terms_version=user_data.terms_version,
        terms_accepted_at=models.utcnow(),
        privacy_version=user_data.privacy_version,
        privacy_acknowledged_at=models.utcnow(),
    )
    db.add(user)
    await db.flush()
    db.add(models.AuditEvent(
        user_id=user.id,
        event_type="legal.account_terms_accepted",
        details={
            "terms_version": user_data.terms_version,
            "privacy_version": user_data.privacy_version,
        },
    ))
    await db.commit()
    await db.refresh(user)
    return user

async def _password_login_session(user_data: schemas.UserLogin, db: AsyncSession) -> tuple[models.User, str]:
    res = await db.execute(select(models.User).where(models.User.email == user_data.email))
    user = res.scalar_one_or_none()
    if not user or not user.hashed_password or not security.verify_password(user_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if security.password_needs_rehash(user.hashed_password):
        user.hashed_password = security.get_password_hash(user_data.password)

    raw_token, hashed_token = security.create_access_token()
    db.add(models.Session(
        user_id=user.id,
        token=hashed_token,
        expires_at=models.utcnow() + timedelta(days=7),
    ))
    db.add(models.AuditEvent(
        user_id=user.id,
        event_type="user.login",
        details={"method": "password"},
    ))
    await db.commit()
    await db.refresh(user)
    return user, raw_token


@app.post('/api/auth/browser-login', response_model=schemas.UserResponse)
@limiter.limit("20/minute")
async def browser_login_user(
    request: Request,
    response: Response,
    user_data: schemas.UserLogin,
    db: AsyncSession = Depends(get_db),
):
    user, raw_token = await _password_login_session(user_data, db)
    auth_settings = get_settings()
    response.set_cookie(
        key=auth_settings.browser_session_cookie_name,
        value=raw_token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=auth_settings.environment in {"staging", "production", "quality_gate"},
        samesite="lax",
        path="/",
    )
    # Deliberately return no bearer token to browser JavaScript.
    return user


@app.post('/api/auth/login')
@limiter.limit("20/minute")
async def login_user(request: Request, user_data: schemas.UserLogin, db: AsyncSession = Depends(get_db)):
    _user, raw_token = await _password_login_session(user_data, db)
    # Explicit API/CLI token endpoint. It intentionally does not set a browser cookie.
    return {"access_token": raw_token, "token_type": "bearer"}


@app.post('/api/auth/logout')
async def logout_user(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    token: Optional[str] = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
):
    from settings import get_settings
    auth_settings = get_settings()
    raw_token = token or request.cookies.get(auth_settings.browser_session_cookie_name)
    if raw_token:
        from security import hash_access_token
        hashed_token = hash_access_token(raw_token)
        res = await db.execute(select(Session).where(Session.token == hashed_token))
        session = res.scalar_one_or_none()
        if session:
            session.revoked_at = models.utcnow()
            await db.commit()
    response.delete_cookie(auth_settings.browser_session_cookie_name, path="/")
    return {"status": "ok"}

# === WORKSPACE ENDPOINTS ===

@app.get('/api/workspaces', response_model=list[schemas.WorkspaceResponse])
async def list_workspaces(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Workspace)
        .join(WorkspaceMembership, WorkspaceMembership.workspace_id == Workspace.id)
        .where(WorkspaceMembership.user_id == current_user.id)
        .order_by(Workspace.created_at.asc())
    )
    return list(result.scalars().unique().all())

@app.post('/api/workspaces', response_model=schemas.WorkspaceResponse)
async def create_workspace(
    data: schemas.WorkspaceCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    owner_email = current_user.email
    source = data.first_touch_source.strip() if data.first_touch_source else None
    ws = Workspace(
        name=data.name,
        owner_email=owner_email,
        subscription_tier="free",
        first_touch_source=source,
        first_touch_at=models.utcnow() if source else None,
    )
    db.add(ws)
    await db.flush()
    
    membership = WorkspaceMembership(
        workspace_id=ws.id,
        user_id=current_user.id,
        role='owner'
    )
    db.add(membership)
    
    audit = AuditEvent(
        workspace_id=ws.id,
        user_id=current_user.id,
        event_type="workspace.created",
        details={"name": data.name, "first_touch_source": source}
    )
    db.add(audit)
    
    await db.commit()
    await db.refresh(ws)
    return ws

@app.get('/api/workspaces/{workspace_id}', response_model=schemas.WorkspaceResponse)
async def get_workspace(
    workspace_id: str, 
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    ws = await require_workspace_capability(workspace_id, 'workspace:read', user, db)
    return ws

def _project_limit_for_tier(tier: str) -> int:
    return {"free": 1, "solo": 10, "studio": 50, "business": 1000000}.get(tier, 1)


async def _workspace_project_for_account(
    workspace_id: str,
    slug: str,
    capability: str,
    user: models.User,
    db: AsyncSession,
) -> tuple[models.Workspace, models.Project]:
    workspace = await auth.require_workspace_capability(workspace_id, capability, user, db)
    res = await db.execute(
        select(models.Project).where(
            models.Project.workspace_id == workspace.id,
            models.Project.slug == slug,
            models.Project.is_deleted == False,
        )
    )
    project = res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found in this workspace")
    return workspace, project


@app.get('/api/workspaces/{workspace_id}/summary', response_model=schemas.WorkspaceSummaryResponse)
async def get_workspace_summary(
    workspace_id: str,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ws = await auth.require_workspace_capability(workspace_id, "workspace:read", user, db)
    project_count = (await db.execute(
        select(func.count(models.Project.id)).where(
            models.Project.workspace_id == ws.id,
            models.Project.is_deleted == False,
        )
    )).scalar() or 0
    effective_tier = entitlements.effective_tier(ws)
    return {
        **schemas.WorkspaceResponse.model_validate(ws).model_dump(),
        "effective_tier": effective_tier,
        "project_count": project_count,
        "project_limit": _project_limit_for_tier(effective_tier),
    }


@app.get('/api/workspaces/{workspace_id}/projects', response_model=list[schemas.ProjectDashboardItem])
async def list_workspace_projects(
    workspace_id: str,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ws = await auth.require_workspace_capability(workspace_id, "workspace:read", user, db)
    res = await db.execute(
        select(models.Project)
        .where(models.Project.workspace_id == ws.id, models.Project.is_deleted == False)
        .order_by(models.Project.created_at.desc())
    )
    projects = list(res.scalars().all())
    return [
        {
            "id": project.id,
            "workspace_id": ws.id,
            "name": project.name,
            "slug": project.slug,
            "description": project.description or "",
            "public_widget_key": project.public_widget_key,
            "ingest_key_configured": bool(project.ingest_key_digest),
            "api_token_configured": bool(project.api_token_digest),
            "telemetry_enabled": bool(project.telemetry_enabled),
            "ai_data_sharing": bool(project.ai_data_sharing),
            "runtime_error_tracking_enabled": bool(getattr(project, "runtime_error_tracking_enabled", False)),
            "created_at": project.created_at,
        }
        for project in projects
    ]


@app.post('/api/workspaces/{workspace_id}/projects/{slug}/rotate-api-token', response_model=schemas.RotateApiTokenResponse)
async def rotate_project_api_token(
    workspace_id: str,
    slug: str,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, project = await _workspace_project_for_account(workspace_id, slug, "workspace:manage", user, db)
    raw_token = f"vb_live_{uuid.uuid4().hex[:24]}"
    project.api_token_digest = security.hash_access_token(raw_token)
    db.add(models.AuditEvent(
        workspace_id=workspace_id,
        project_id=project.id,
        user_id=user.id,
        event_type="project.api_token.rotated",
        details={"slug": project.slug},
    ))
    await db.commit()
    return {"token": raw_token}


@app.post('/api/workspaces/{workspace_id}/projects/{slug}/rotate-public-key', response_model=schemas.RotatePublicWidgetKeyResponse)
async def rotate_project_public_widget_key(
    workspace_id: str,
    slug: str,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, project = await _workspace_project_for_account(workspace_id, slug, "workspace:manage", user, db)
    raw_public_key = f"vb_pub_{uuid.uuid4().hex[:24]}"
    project.public_widget_key = raw_public_key
    project.public_widget_key_digest = security.hash_access_token(raw_public_key)
    db.add(models.AuditEvent(
        workspace_id=workspace_id,
        project_id=project.id,
        user_id=user.id,
        event_type="project.public_widget_key.rotated",
        details={"slug": project.slug},
    ))
    await db.commit()
    return {"public_widget_key": raw_public_key}


@app.post('/api/workspaces/{workspace_id}/projects/{slug}/rotate-ingest-key', response_model=schemas.RotateIngestKeyResponse)
async def rotate_project_ingest_key(
    workspace_id: str,
    slug: str,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, project = await _workspace_project_for_account(workspace_id, slug, "workspace:manage", user, db)
    new_raw = await error_bridge.rotate_ingest_key(db, project)
    db.add(models.AuditEvent(
        workspace_id=workspace_id,
        project_id=project.id,
        user_id=user.id,
        event_type="project.ingest_key.rotated",
        details={"slug": project.slug},
    ))
    await db.commit()
    return {"ingest_key": new_raw}


@app.get('/api/workspaces/{workspace_id}/projects/{slug}/errors', response_model=list[schemas.ErrorGroupItem])
async def list_project_errors(
    workspace_id: str,
    slug: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, project = await _workspace_project_for_account(workspace_id, slug, "workspace:read", user, db)
    res = await db.execute(
        select(models.ErrorGroup)
        .where(models.ErrorGroup.project_id == project.id)
        .order_by(models.ErrorGroup.last_seen_at.desc())
        .offset(offset)
        .limit(limit)
    )
    groups = list(res.scalars().all())
    ticket_ids = [g.ticket_id for g in groups if g.ticket_id]
    ticket_map = {}
    if ticket_ids:
        ticket_rows = await db.execute(
            select(models.SpecTicket.id, models.SpecTicket.key, models.SpecTicket.status)
            .where(models.SpecTicket.id.in_(ticket_ids), models.SpecTicket.is_deleted == False)
        )
        ticket_map = {row.id: row for row in ticket_rows.all()}

    items = []
    for g in groups:
        ticket = ticket_map.get(g.ticket_id) if g.ticket_id else None
        effective_status = g.status
        if g.status != "ignored" and ticket:
            effective_status = "resolved" if ticket.status == "done" else "open"
        items.append({
            "id": g.id,
            "project_id": g.project_id,
            "fingerprint": g.fingerprint,
            "service": g.service,
            "exception_type": g.exception_type,
            "normalized_message": g.normalized_message,
            "route": g.route,
            "top_frame": g.top_frame,
            "status": effective_status,
            "occurrences_count": g.occurrences_count,
            "first_seen_at": g.first_seen_at,
            "last_seen_at": g.last_seen_at,
            "ticket_id": g.ticket_id,
            "ticket_key": ticket.key if ticket else None,
        })
    return items


@app.get('/api/workspaces/{workspace_id}/projects/{slug}/errors/{group_id}', response_model=schemas.ErrorGroupDetailResponse)
async def get_project_error_detail(
    workspace_id: str,
    slug: str,
    group_id: str,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, project = await _workspace_project_for_account(workspace_id, slug, "workspace:read", user, db)
    res = await db.execute(
        select(models.ErrorGroup).where(
            models.ErrorGroup.id == group_id,
            models.ErrorGroup.project_id == project.id,
        )
    )
    group = res.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Error group not found")

    occ_res = await db.execute(
        select(models.ErrorOccurrence)
        .where(models.ErrorOccurrence.group_id == group.id)
        .order_by(models.ErrorOccurrence.created_at.desc())
        .limit(1)
    )
    latest_occ = occ_res.scalar_one_or_none()
    latest_occ_item = None
    if latest_occ:
        latest_occ_item = {
            "id": latest_occ.id,
            "request_id": latest_occ.request_id,
            "environment": latest_occ.environment,
            "release": latest_occ.release,
            "method": latest_occ.method,
            "route": latest_occ.route,
            "status_code": latest_occ.status_code,
            "stack": latest_occ.stack or [],
            "created_at": latest_occ.created_at,
        }

    ticket = None
    if group.ticket_id:
        t_res = await db.execute(
            select(models.SpecTicket)
            .where(models.SpecTicket.id == group.ticket_id, models.SpecTicket.is_deleted == False)
        )
        ticket = t_res.scalar_one_or_none()

    effective_status = group.status
    if group.status != "ignored" and ticket:
        effective_status = "resolved" if ticket.status == "done" else "open"

    return {
        "id": group.id,
        "project_id": group.project_id,
        "fingerprint": group.fingerprint,
        "service": group.service,
        "exception_type": group.exception_type,
        "normalized_message": group.normalized_message,
        "route": group.route,
        "top_frame": group.top_frame,
        "status": effective_status,
        "occurrences_count": group.occurrences_count,
        "first_seen_at": group.first_seen_at,
        "last_seen_at": group.last_seen_at,
        "ticket_id": group.ticket_id,
        "ticket_key": ticket.key if ticket else None,
        "latest_occurrence": latest_occ_item,
        "ticket_title": ticket.title if ticket else None,
        "ticket_status": ticket.status if ticket else None,
    }


@app.patch('/api/workspaces/{workspace_id}/projects/{slug}/errors/{group_id}')
async def update_project_error_status(
    workspace_id: str,
    slug: str,
    group_id: str,
    payload: schemas.ErrorGroupStatusUpdate,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, project = await _workspace_project_for_account(workspace_id, slug, "project:write", user, db)
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
    if payload.status == "resolved" and group.ticket_id:
        t_res = await db.execute(
            select(models.SpecTicket)
            .where(models.SpecTicket.id == group.ticket_id, models.SpecTicket.is_deleted == False)
            .with_for_update()
        )
        ticket = t_res.scalar_one_or_none()
        if ticket and ticket.status != "done":
            ticket.status = "done"
            ticket.revision = int(ticket.revision or 0) + 1

    await db.commit()
    await db.refresh(group)
    return {"id": group.id, "status": group.status}


@app.post('/api/workspaces/{workspace_id}/projects/{slug}/errors/test-event')
async def trigger_test_error_event(
    workspace_id: str,
    slug: str,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, project = await _workspace_project_for_account(workspace_id, slug, "project:write", user, db)
    if not bool(getattr(project, "runtime_error_tracking_enabled", False)):
        raise HTTPException(
            status_code=403,
            detail="Сбор ошибок отключен. Включите «Runtime Error Tracking» в настройках проекта перед отправкой теста.",
        )

    test_payload = schemas.ErrorIngestPayload(
        service="backend-api",
        exception_type="ZeroDivisionError",
        message="division by zero in calculate_discount() for test-order-42",
        route="/api/v1/checkout/calculate",
        method="POST",
        status_code=500,
        environment="staging",
        release="v1.0.0-test",
        request_id=f"test_req_{uuid.uuid4().hex[:8]}",
        stack=[
            {"filename": "app/services/checkout.py", "lineno": 88, "function": "calculate_discount"},
            {"filename": "app/api/endpoints/orders.py", "lineno": 42, "function": "create_order"},
        ],
    )
    result = await error_bridge.ingest_runtime_error(db, project, test_payload)
    return {
        "success": True,
        "message": "Тестовый сбой успешно отправлен в Runtime Bridge",
        "group_id": result.group_id,
        "ticket_id": result.ticket_id,
        "ticket_key": result.ticket_key,
        "occurrences_count": result.occurrences_count,
    }


@app.patch('/api/workspaces/{workspace_id}/projects/{slug}/settings')
async def update_project_settings(
    workspace_id: str,
    slug: str,
    payload: schemas.RuntimeErrorTrackingSettingsUpdate,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, project = await _workspace_project_for_account(workspace_id, slug, "workspace:manage", user, db)
    project.runtime_error_tracking_enabled = payload.runtime_error_tracking_enabled
    await db.commit()
    await db.refresh(project)
    return {
        "slug": project.slug,
        "runtime_error_tracking_enabled": project.runtime_error_tracking_enabled,
    }


@app.delete('/api/workspaces/{workspace_id}/projects/{slug}')
async def delete_workspace_project(
    workspace_id: str,
    slug: str,
    confirmation_slug: str,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, project = await _workspace_project_for_account(workspace_id, slug, "workspace:manage", user, db)
    if confirmation_slug != slug:
        raise HTTPException(status_code=400, detail="Project confirmation does not match")
    if slug == "demo-showcase":
        raise HTTPException(status_code=403, detail="Demo project is protected")
    success = await crud.delete_project(db, project.id)
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"deleted": True, "slug": slug}

@app.put('/api/workspaces/{workspace_id}/tier', response_model=schemas.WorkspaceResponse)
async def update_workspace_tier(
    workspace_id: str, 
    tier: str, 
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    raise HTTPException(status_code=403, detail="Direct tier override is forbidden in production")
    
    ws = await crud.get_workspace_by_id(db, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
        
    updated = await crud.update_workspace_tier(db, workspace_id, tier)
    return updated

@app.post('/api/workspaces/{workspace_id}/redeem-promo', response_model=schemas.RedeemPromoResponse)
@limiter.limit("10/minute")
async def redeem_promo(
    request: Request,
    workspace_id: str,
    data: schemas.RedeemPromoRequest,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await auth.require_workspace_capability(workspace_id, "workspace:billing", user, db)
    ws, promo = await crud.redeem_promo_code(db, workspace_id, data.code, user_id=user.id)
    payload = schemas.WorkspaceResponse.model_validate(ws).model_dump()
    payload.update({
        "promo_campaign": promo.campaign,
        "promo_duration_days": None if promo.grants_lifetime else int(promo.duration_days or 30),
    })
    return payload

# === ACCESS LINKS ENDPOINTS ===

@app.post('/api/projects/{slug}/access-links', response_model=schemas.AccessLinkResponse)
async def create_access_link_endpoint(
    slug: str,
    data: schemas.AccessLinkCreate,
    project: Project = Depends(auth.get_project_for_settings),
    db: AsyncSession = Depends(get_db)
):
    link, raw_token = await crud.create_access_link(db, project.id, data)
    return {
        "id": link.id,
        "project_id": link.project_id,
        "token": raw_token,
        "label": link.label,
        "role": link.role,
        "ttl": link.ttl,
        "single_use": link.single_use,
        "is_activated": link.is_activated,
        "expires_at": link.expires_at,
        "created_at": link.created_at
    }

@app.get('/api/projects/{slug}/access-links', response_model=List[schemas.AccessLinkListItemResponse])
async def list_access_links_endpoint(
    slug: str,
    project: Project = Depends(auth.get_project_for_settings),
    db: AsyncSession = Depends(get_db)
):
    return await crud.get_project_access_links(db, project.id)

@app.delete('/api/projects/{slug}/access-links/{link_id}')
async def delete_access_link_endpoint(
    slug: str,
    link_id: str,
    project: Project = Depends(auth.get_project_for_settings),
    db: AsyncSession = Depends(get_db)
):
    success = await crud.delete_access_link(db, project.id, link_id)
    if not success:
        raise HTTPException(status_code=404, detail="Access link not found")
    return {"deleted": True}

@app.post('/api/access-links/verify', response_model=schemas.AccessLinkVerifyResponse)
async def verify_access_link_endpoint(
    data: schemas.AccessLinkVerifyRequest,
    db: AsyncSession = Depends(get_db)
):
    return await crud.verify_and_consume_access_link(db, data.token, data.fingerprint)

def _validated_billing_return_url(raw_url: Optional[str], fallback_path: str) -> str:
    """Allow payment-provider redirects only back to trusted first-party origins.

    Authenticated users must not be able to turn a VibeUs checkout into a
    provider-hosted open redirect to an arbitrary phishing origin.
    """
    cfg = get_settings()
    fallback = str(cfg.public_base_url).rstrip("/") + fallback_path
    candidate = (raw_url or fallback).strip()
    try:
        parsed = urlsplit(candidate)
        candidate_origin = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid billing return URL")

    trusted = {str(cfg.public_base_url).rstrip("/")}
    if cfg.environment in {"development", "test"}:
        trusted.update({"https://vibus.dev", "http://localhost:5173", "http://localhost:3000", "http://localhost:8000", "http://127.0.0.1:8000"})
        if isinstance(cfg.cors_origins, str):
            trusted.update(p.strip().rstrip("/") for p in cfg.cors_origins.split(",") if p.strip())
        elif isinstance(cfg.cors_origins, (list, tuple, set)):
            for item in cfg.cors_origins:
                trusted.update(p.strip().rstrip("/") for p in str(item).split(",") if p.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or candidate_origin not in trusted:
        raise HTTPException(status_code=422, detail="Billing return URL must use a trusted VibeUs origin")
    return candidate


# === STRIPE BILLING ENDPOINTS ===

import stripe_service

@app.post('/api/billing/create-checkout-session')
@limiter.limit("10/minute")
async def create_checkout_session(request: Request, data: schemas.CreateCheckoutRequest, user: models.User = Depends(auth.get_current_user), db: AsyncSession = Depends(get_db)):
    if not get_settings().enable_stripe and not get_settings().enable_mock_billing:
        raise HTTPException(status_code=503, detail="Stripe billing is disabled")
    ws = await auth.require_workspace_capability(data.workspace_id, "workspace:billing", user, db)
    success_url = _validated_billing_return_url(data.success_url, "/billing/success?session_id={CHECKOUT_SESSION_ID}")
    cancel_url = _validated_billing_return_url(data.cancel_url, "/billing/cancel")
    
    session_data = await stripe_service.create_checkout_session(
        workspace_id=ws.id,
        owner_email=ws.owner_email,
        tier=data.tier or "solo",
        success_url=success_url,
        cancel_url=cancel_url,
        db=db
    )
    return session_data

@app.post('/api/billing/create-portal-session')
@limiter.limit("10/minute")
async def create_portal_session(request: Request, data: schemas.CreatePortalRequest, user: models.User = Depends(auth.get_current_user), db: AsyncSession = Depends(get_db)):
    if not get_settings().enable_stripe:
        raise HTTPException(status_code=503, detail="Stripe billing is disabled")
    ws = await auth.require_workspace_capability(data.workspace_id, "workspace:billing", user, db)
    return_url = _validated_billing_return_url(data.return_url, "/")
    
    if not ws.stripe_customer_id:
        raise HTTPException(status_code=400, detail="У данного воркспейса нет активного Stripe Customer ID")
    
    portal_data = await stripe_service.create_portal_session(
        stripe_customer_id=ws.stripe_customer_id,
        return_url=return_url
    )
    return portal_data

@app.post('/api/billing/webhook')
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    if not get_settings().enable_stripe and not get_settings().enable_mock_billing:
        raise HTTPException(status_code=503, detail="Stripe billing is disabled")
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    result = await stripe_service.process_webhook_event(payload, sig_header, db)
    return result

# === YOOKASSA BILLING (RUB, SBP, МИР) ===

import yookassa_service

@app.post('/api/billing/yookassa/create-payment')
@limiter.limit("15/minute")
async def create_yookassa_payment(request: Request, data: schemas.CreateYookassaPaymentRequest, user: models.User = Depends(auth.get_current_user), db: AsyncSession = Depends(get_db)):
    if not get_settings().enable_yookassa and not get_settings().enable_mock_billing:
        raise HTTPException(status_code=503, detail="YooKassa billing is disabled")
    ws = await auth.require_workspace_capability(data.workspace_id, "workspace:billing", user, db)
    return_url = _validated_billing_return_url(data.return_url, "/billing/success")

    idempotency_key = request.headers.get("Idempotency-Key")
    if idempotency_key:
        idempotency_key = idempotency_key.strip()[:64]
    
    # If B2B is enabled, save INN and company name in the workspace for future reference
    if data.is_b2b and data.company_inn:
        ws.company_inn = data.company_inn
        ws.company_name = data.company_name
        await db.commit()

    payment_data = await yookassa_service.create_yookassa_payment(
        workspace_id=ws.id,
        owner_email=ws.owner_email,
        tier=data.tier or "solo",
        return_url=return_url,
        is_b2b=data.is_b2b,
        company_inn=data.company_inn,
        company_name=data.company_name,
        db=db,
        idempotency_key=idempotency_key
    )
    return payment_data

@app.post('/api/billing/yookassa/webhook')
async def yookassa_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    if not get_settings().enable_yookassa and not get_settings().enable_mock_billing:
        raise HTTPException(status_code=503, detail="YooKassa billing is disabled")
    payload = await request.json()
    result = await yookassa_service.process_yookassa_webhook(payload, db)
    return result

@app.post('/api/workspaces/{workspace_id}/refuse-payment-method')
async def refuse_payment_method(
    workspace_id: str,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db)
):
    ws = await auth.require_workspace_capability(workspace_id, "workspace:billing", user, db)
    billing_provider = getattr(ws, "billing_provider", "free") or "free"
    if ws.stripe_customer_id or billing_provider == "stripe":
        try:
            await stripe_service.disable_recurring_payment(ws.stripe_customer_id)
        except Exception as e:
            logger.error(f"Provider cancellation failure: {e}")
            raise HTTPException(status_code=502, detail="Payment provider failed to disable recurring payment")
    elif billing_provider == "yookassa" or "yookassa" in str(billing_provider).lower():

        pm_id = getattr(ws, "yookassa_payment_method_id", None)
        try:
            await yookassa_service.cancel_auto_payments(payment_method_id=pm_id, workspace_id=ws.id, db=db)
        except Exception as e:
            logger.error(f"YooKassa recurring cancellation failure: {e}")
            raise HTTPException(status_code=502, detail="Payment provider failed to disable recurring payment")
        ws.yookassa_payment_method_id = None

    ws.payment_method_refused = True
    ws.payment_method_refused_at = models.utcnow()
    await db.commit()
    await db.refresh(ws)
    return {"status": "ok", "payment_method_refused": True}


@app.get('/api/workspaces/{workspace_id}/payments', response_model=list[schemas.PaymentResponse])
async def list_workspace_payments(
    workspace_id: str,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db)
):
    await auth.require_workspace_capability(workspace_id, "workspace:billing", user, db)
    res = await db.execute(
        select(models.Payment)
        .where(models.Payment.workspace_id == workspace_id)
        .order_by(models.Payment.created_at.desc())
    )
    return list(res.scalars().all())



# Receipt issuance is an operator-side fiscal action. Customers may read payment
# history above, but cannot mutate fiscal state through the public workspace API.


# === PROJECT ENDPOINTS ===

@app.post('/api/projects', response_model=schemas.ProjectCreateResponse)
@limiter.limit("60/minute")
async def create_project(request: Request, data: schemas.ProjectCreate, current_user: models.User = Depends(auth.get_current_user), db: AsyncSession = Depends(get_db)):

    # Check if slug already taken
    existing = await crud.get_project_by_slug(db, data.slug)
    if existing:
        raise HTTPException(status_code=409, detail=f'Project with slug "{data.slug}" already exists')
    
    # Tenancy is explicit: project creation always names a workspace, and the
    # caller must have workspace:manage on that exact workspace.
    if not data.workspace_id:
        raise HTTPException(status_code=422, detail="workspace_id is required")
    workspace = await auth.require_workspace_capability(data.workspace_id, "workspace:manage", current_user, db)

    project, raw_token, raw_public_key, raw_ingest_key = await crud.create_project(db, data, workspace=workspace)
    return {
        "id": project.id,
        "workspace_id": project.workspace_id,
        "name": project.name,
        "slug": project.slug,
        "description": project.description,
        "telemetry_enabled": project.telemetry_enabled,
        "ai_data_sharing": project.ai_data_sharing,
        "runtime_error_tracking_enabled": bool(getattr(project, "runtime_error_tracking_enabled", False)),
        "columns": project.columns or [],
        "created_at": project.created_at,
        "token": raw_token,
        "public_widget_key": raw_public_key,
        "ingest_key": raw_ingest_key,
    }

@app.post('/api/ingest/errors', response_model=schemas.ErrorIngestResponse)
@limiter.limit("120/minute")
async def ingest_error_endpoint(
    request: Request,
    payload: schemas.ErrorIngestPayload,
    db: AsyncSession = Depends(get_db),
):
    auth_header = request.headers.get("x-vibeus-ingest-key") or request.headers.get("authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing X-VibeUs-Ingest-Key or Authorization header")

    raw_key = auth_header.strip()
    if raw_key.lower().startswith("bearer "):
        raw_key = raw_key[7:].strip()

    project = await error_bridge.get_project_by_ingest_key(db, raw_key)
    if not project:
        raise HTTPException(status_code=401, detail="Invalid or revoked ingest key")

    result = await error_bridge.ingest_runtime_error(db, project, payload)
    # Auto-ticket creation and regression reopening are real board mutations.
    # Keep connected Studio/CLI clients authoritative without broadcasting every
    # repeated occurrence in a noisy error storm.
    if result.occurrences_count == 1 or result.is_regression:
        await db.refresh(project)
        await manager.broadcast(
            {"type": "board.refresh", "revision": project.revision or 0},
            project.id,
        )
    return result

@app.get('/api/projects/{slug}', response_model=schemas.ProjectResponse)
async def get_project(project: Project = Depends(get_project_by_token)):
    return project

@app.get('/api/projects/{slug}/board')
async def get_board(
    slug: str,
    request: Request,
    x_api_token: Optional[str] = Header(None, alias='X-API-Token'),
    authorization: Optional[str] = Header(None, alias='Authorization'),
    x_device_fingerprint: Optional[str] = Header(None, alias='X-Device-Fingerprint'),
    db: AsyncSession = Depends(get_db)
):
    project = await auth.require_project_capability(
        slug=slug,
        required_capability="project:read",
        token=None,
        x_api_token=x_api_token,
        authorization=authorization,
        x_device_fingerprint=x_device_fingerprint,
        preview_session_cookie=request.cookies.get(get_settings().preview_session_cookie_name),
        db=db
    )
    board = await crud.get_full_board(db, project.id)
    return board

@app.delete('/api/projects/{slug}')
async def delete_project(
    slug: str,
    confirmation_slug: str,
    project: Project = Depends(auth.get_project_for_settings),
    db: AsyncSession = Depends(get_db)
):
    if confirmation_slug != slug:
        raise HTTPException(
            status_code=400,
            detail=f'Строка подтверждения "{confirmation_slug}" не совпадает с именем проекта "{slug}"'
        )
    if slug == "demo-showcase":
        raise HTTPException(status_code=403, detail="Демо-проект demo-showcase защищен от удаления")
    
    success = await crud.delete_project(db, project.id)
    if not success:
        raise HTTPException(status_code=404, detail="Проект не найден")
    return {"deleted": True, "slug": slug}

_feedback_locks: dict[str, asyncio.Lock] = {}
_idempotency_feedback_cache: dict[str, dict] = {}

# === PUBLIC FEEDBACK SUBMISSION (No Token Required) ===

@app.post('/api/projects/{slug}/feedback')
@limiter.limit("30/minute")
async def submit_public_feedback(
    request: Request,
    slug: str,
    feedback_data: FeedbackCreate,
    project: Project = Depends(get_project_public),
    db: AsyncSession = Depends(get_db)
):
    raw_public_key = request.headers.get("X-Vibus-Public-Key") or request.headers.get("X-Public-Widget-Key")
    if not raw_public_key:
        raise HTTPException(status_code=401, detail="Missing public widget credential")
    
    from security import hash_access_token
    expected_digest = getattr(project, "public_widget_key_digest", None)
    if not expected_digest or hash_access_token(raw_public_key) != expected_digest:
        raise HTTPException(status_code=403, detail="Invalid public widget key")

    origins = [str(item).rstrip("/") for item in (getattr(project, "public_widget_origins", None) or []) if item]
    origin = (request.headers.get("Origin") or "").rstrip("/")
    if origins:
        if not origin:
            raise HTTPException(status_code=403, detail="Origin header is required for this public widget")
        if origin not in origins:
            raise HTTPException(status_code=403, detail="Origin not allowed")

    idempotency_key = request.headers.get("Idempotency-Key")

    if idempotency_key:
        res_existing = await db.execute(
            select(models.Feedback)
            .where(
                models.Feedback.project_id == project.id,
                models.Feedback.idempotency_key == idempotency_key
            )
        )
        existing = res_existing.scalar_one_or_none()
        if existing:
            return {"status": "ok", "id": existing.id, "feedback_id": existing.id}

    fb_id = f"fb_{uuid.uuid4().hex[:12]}"
    new_fb_details = {
        "author": feedback_data.author or "Посетитель",
        "contact": feedback_data.contact or "",
        "quote": feedback_data.quote or "",
        "request_id": feedback_data.request_id or "",
    }
    category_val = feedback_data.category.value if hasattr(feedback_data.category, "value") else str(feedback_data.category)

    fb = models.Feedback(
        id=fb_id,
        project_id=project.id,
        idempotency_key=idempotency_key,
        text=feedback_data.text,
        category=category_val,
        status="new",
        created_at=models.utcnow(),
        details=new_fb_details
    )
    db.add(fb)
    try:
        await db.commit()
        await db.refresh(fb)
    except Exception:
        await db.rollback()
        if idempotency_key:
            for _ in range(10):
                await asyncio.sleep(0.05)
                try:
                    res_existing = await db.execute(
                        select(models.Feedback)
                        .where(
                            models.Feedback.project_id == project.id,
                            models.Feedback.idempotency_key == idempotency_key
                        )
                    )
                    existing = res_existing.scalar_one_or_none()
                    if existing:
                        return {"status": "ok", "id": existing.id, "feedback_id": existing.id}
                except Exception:
                    pass
            raise HTTPException(status_code=409, detail="Concurrent duplicate feedback submission")
        raise

    subscribers = list(project.subscribers or [])
    proj_slug = project.slug
    proj_id = project.id
    proj_group_chat = getattr(project, 'group_chat', None)

    feedback_payload = {
        "id": fb.id,
        "idempotency_key": fb.idempotency_key,
        "text": fb.text,
        "category": fb.category,
        "status": fb.status,
        "created_at": fb.created_at.isoformat() if fb.created_at else None,
        **new_fb_details
    }

    # Notify Telegram subscribers
    await telegram_service.notify_new_public_feedback(
        subscribers,
        proj_slug,
        feedback_payload,
        proj_group_chat
    )

    # Broadcast to active dashboard connections
    await manager.broadcast({
        "type": "new_feedback",
        "feedback": feedback_payload
    }, proj_id)

    return {"status": "ok", "id": fb_id, "feedback_id": fb_id}

# === NODE ENDPOINTS ===

@app.post('/api/projects/{slug}/nodes')
async def create_node(
    slug: str,
    data: NodeCreate,
    project: Project = Depends(get_project_by_token),
    db: AsyncSession = Depends(get_db)
):
    node = await crud.create_node(db, project.id, data)
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return {'id': node.id, 'title': node.title}

@app.patch('/api/projects/{slug}/nodes/{node_id}')
async def update_node(
    slug: str,
    node_id: str,
    data: schemas.NodeUpdate,
    project: Project = Depends(get_project_by_token),
    db: AsyncSession = Depends(get_db)
):
    node = await crud.update_node(db, project.id, node_id, data.model_dump(exclude_unset=True))
    if not node:
        raise HTTPException(status_code=404, detail="Node not found in this project")
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return {'id': node.id, 'title': node.title, 'description': node.description, 'content_markdown': node.content_markdown}

@app.delete('/api/projects/{slug}/nodes/{node_id}')
async def delete_node(
    slug: str,
    node_id: str,
    project: Project = Depends(get_project_by_token),
    db: AsyncSession = Depends(get_db)
):
    success = await crud.delete_node(db, project.id, node_id)
    if not success:
        raise HTTPException(status_code=404, detail="Node not found in this project")
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return {'deleted': True, 'id': node_id}

# === TICKET ENDPOINTS ===

@app.post('/api/projects/{slug}/nodes/{node_id}/tickets')
async def create_ticket(
    slug: str,
    node_id: str,
    data: TicketCreate,
    project: Project = Depends(get_project_by_token),
    db: AsyncSession = Depends(get_db)
):
    ticket = await crud.create_ticket(db, project.id, node_id, data)
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return {
        'id': ticket.id,
        'key': ticket.key,
        'title': ticket.title,
        'status': ticket.status,
        'priority': ticket.priority,
        'revision': ticket.revision or 0,
        'bug_context': ticket.bug_context or {}
    }

@app.put('/api/projects/{slug}/tickets/{ticket_id}')
async def update_ticket(
    slug: str,
    ticket_id: str,
    data: TicketUpdate,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    project: Project = Depends(get_project_by_token),
    db: AsyncSession = Depends(get_db)
):
    if data.status is not None and str(getattr(data.status, "value", data.status)) == "review":
        current_res = await db.execute(
            select(models.SpecTicket)
            .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
            .where(models.SpecTicket.id == ticket_id, models.SpecNode.project_id == project.id, models.SpecTicket.is_deleted == False)
        )
        current_ticket = current_res.scalar_one_or_none()
        if current_ticket:
            ready, missing = _criteria_auto_review_ready(current_ticket)
            if not ready:
                raise HTTPException(status_code=409, detail={"code": "criteria_unverified", "missing_criteria": missing[:50]})
    ticket = await crud.update_ticket(db, project.id, ticket_id, data, if_match=if_match)
    if not ticket:
        raise HTTPException(status_code=404, detail='Ticket not found')
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return {'id': ticket.id, 'key': ticket.key, 'status': ticket.status, 'revision': ticket.revision or 0}

@app.post('/api/projects/{slug}/tickets/{ticket_id}/criteria/manual-verify')
async def manual_verify_ticket_criterion(
    slug: str,
    ticket_id: str,
    payload: dict = Body(...),
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    key = str(payload.get("key") or "").strip()
    note = str(payload.get("note") or "").strip()[:2000]
    if not key or len(key) > 500:
        raise HTTPException(status_code=422, detail="criterion key is required")
    project = await crud.get_project_by_slug(db, slug)
    if not project or not project.workspace_id:
        raise HTTPException(status_code=404, detail="Project not found")
    mem_res = await db.execute(
        select(models.WorkspaceMembership).where(
            models.WorkspaceMembership.workspace_id == project.workspace_id,
            models.WorkspaceMembership.user_id == user.id,
        )
    )
    membership = mem_res.scalar_one_or_none()
    caps = auth.ROLE_CAPABILITIES_MATRIX.get(getattr(membership, "role", ""), []) if membership else []
    if "ticket:review" not in caps:
        raise HTTPException(status_code=403, detail="Human review capability required")
    t_res = await db.execute(
        select(models.SpecTicket)
        .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
        .where(models.SpecTicket.id == ticket_id, models.SpecNode.project_id == project.id, models.SpecTicket.is_deleted == False)
        .with_for_update()
    )
    ticket = t_res.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not bool((ticket.checklists or {}).get(key)):
        raise HTTPException(status_code=409, detail="Criterion must be claimed before human verification")
    contract = dict(ticket.criteria_contract or {}).get(key)
    if not isinstance(contract, dict):
        raise HTTPException(status_code=409, detail="Structured criterion contract is missing")
    now = datetime.now(timezone.utc).isoformat()
    receipt = _sign_criteria_receipt({
        "criterion_key": key,
        "criterion_id": str(contract.get("id") or key),
        "contract_sha256": criteria_contract_fingerprint(key, contract),
        "provenance": "human_review",
        "adapter": "human_review",
        "target": "browser-session",
        "verifier": f"user:{user.id}",
        "started_at": now,
        "completed_at": now,
        "verified": True,
        "result": "PASS",
        "observed": note or "Explicit human verification by an authenticated workspace reviewer.",
    })
    evidence = dict(ticket.criteria_evidence or {})
    evidence[key] = receipt
    ticket.criteria_evidence = evidence
    ticket.revision = (ticket.revision or 0) + 1
    project.revision = (project.revision or 0) + 1
    db.add(models.AuditEvent(
        workspace_id=project.workspace_id,
        project_id=project.id,
        user_id=user.id,
        event_type="criteria.human_verified",
        details={"ticket_id": ticket.id, "criterion": key},
    ))
    await db.commit()
    await manager.broadcast({"type": "board.refresh", "revision": project.revision}, project.id)
    return {"criterion": key, "evidence": receipt, "revision": ticket.revision}


@app.post('/api/projects/{slug}/tickets/{ticket_id}/review')
async def review_ticket(
    slug: str,
    ticket_id: str,
    data: schemas.TicketReviewActionRequest,
    project: Project = Depends(auth.get_project_for_review),
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
        ticket.status = "done"
        ticket.rework_notes = ""
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

    ticket.revision = (ticket.revision or 0) + 1
    project.revision = (project.revision or 0) + 1
    await db.commit()
    await manager.broadcast({"type": "board.refresh", "revision": project.revision}, project.id)
    return {
        "id": ticket.id,
        "status": ticket.status,
        "rework_notes": ticket.rework_notes or "",
        "revision": ticket.revision or 0,
    }


@app.delete('/api/projects/{slug}/tickets/{ticket_id}')
async def delete_ticket(
    slug: str,
    ticket_id: str,
    project: Project = Depends(get_project_by_token),
    db: AsyncSession = Depends(get_db)
):
    success = await crud.delete_ticket(db, project.id, ticket_id)
    if not success:
        raise HTTPException(status_code=404, detail='Ticket not found')
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return {'deleted': True}

@app.post('/api/projects/{slug}/tickets/{ticket_id}/move')
async def move_ticket(
    slug: str,
    ticket_id: str,
    data: schemas.TicketMoveRequest,
    project: Project = Depends(get_project_by_token),
    db: AsyncSession = Depends(get_db)
):
    ticket = await crud.move_ticket(db, project.id, ticket_id, data.node_id, data.order or 0)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket or destination node not found in this project")
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return {'id': ticket.id, 'node_id': ticket.node_id, 'order': ticket.order, 'revision': ticket.revision or 0}

@app.post('/api/projects/{slug}/tickets/batch')
async def batch_tickets(
    slug: str,
    data: schemas.TicketBatchRequest,
    project: Project = Depends(get_project_by_token),
    db: AsyncSession = Depends(get_db)
):
    result = await crud.batch_tickets_operation(db, project.id, data.operation)
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return result

# === PROJECT SETTINGS ENDPOINTS ===

@app.patch('/api/projects/{slug}/settings')
async def update_project_settings(
    slug: str,
    data: schemas.ProjectSettingsUpdate,
    project: Project = Depends(auth.get_project_for_settings),
    db: AsyncSession = Depends(get_db)
):
    await crud.update_project_settings(db, project.id, data.model_dump(exclude_unset=True))
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return {'status': 'ok', 'revision': project.revision or 0}

@app.delete('/api/projects/{slug}/columns/{column_id}')
async def delete_column(
    slug: str,
    column_id: str,
    project: Project = Depends(auth.get_project_for_settings),
    db: AsyncSession = Depends(get_db)
):
    await crud.delete_column(db, project.id, column_id)
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return {'status': 'ok', 'revision': project.revision or 0}

# === DISCUSSIONS ENDPOINTS ===

@app.post('/api/projects/{slug}/nodes/{node_id}/discussions')
async def create_node_discussion(
    slug: str,
    node_id: str,
    data: schemas.DiscussionCreate,
    project: Project = Depends(auth.get_project_for_comment),
    db: AsyncSession = Depends(get_db)
):
    disc = await crud.create_discussion(db, project.id, node_id, data)
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return disc

@app.post('/api/projects/{slug}/nodes/{node_id}/discussions/{discussion_id}/comments')
async def add_node_discussion_comment(
    slug: str,
    node_id: str,
    discussion_id: str,
    data: schemas.DiscussionCommentCreate,
    project: Project = Depends(auth.get_project_for_comment),
    db: AsyncSession = Depends(get_db)
):
    comment = await crud.add_discussion_comment(db, project.id, node_id, discussion_id, data)
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return comment

@app.patch('/api/projects/{slug}/nodes/{node_id}/discussions/{discussion_id}')
async def update_node_discussion(
    slug: str,
    node_id: str,
    discussion_id: str,
    data: schemas.DiscussionUpdate,
    project: Project = Depends(get_project_by_token),
    db: AsyncSession = Depends(get_db)
):
    disc = await crud.update_discussion(db, project.id, node_id, discussion_id, data)
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return disc

@app.post('/api/projects/{slug}/nodes/{node_id}/discussions/{discussion_id}/convert-to-ticket')
async def convert_node_discussion_to_ticket(
    slug: str,
    node_id: str,
    discussion_id: str,
    data: schemas.DiscussionConvertToTicket,
    project: Project = Depends(get_project_by_token),
    db: AsyncSession = Depends(get_db)
):
    result = await crud.convert_discussion_to_ticket(db, project.id, node_id, discussion_id, data)
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return result

# === FEEDBACK CONVERT ENDPOINT ===

@app.post('/api/projects/{slug}/feedback/{feedback_id}/convert-to-ticket')
async def convert_feedback_to_ticket(
    slug: str,
    feedback_id: str,
    data: schemas.FeedbackConvertToTicket,
    project: Project = Depends(get_project_by_token),
    db: AsyncSession = Depends(get_db)
):
    result = await crud.convert_feedback_to_ticket(db, project.id, feedback_id, data)
    await manager.broadcast({"type": "board.refresh", "revision": project.revision or 0}, project.id)
    return result

# === GITHUB INTEGRATION ENDPOINTS ===

@app.get('/api/projects/{slug}/github', response_model=schemas.GitHubConfigResponse)
async def get_github_config(
    slug: str,
    project: Project = Depends(auth.get_project_for_integration)
):
    """Get GitHub configuration for project (token is masked)."""
    return {
        "github_repo": project.github_repo,
        "has_token": bool(project.github_token),
        "github_sync_enabled": bool(project.github_sync_enabled)
    }

@app.post('/api/projects/{slug}/github', response_model=schemas.GitHubConfigResponse)
async def save_github_config(
    slug: str,
    data: schemas.GitHubConfigRequest,
    project: Project = Depends(auth.get_project_for_integration),
    db: AsyncSession = Depends(get_db)
):
    """Save or update GitHub repository and PAT token for project."""
    if data.github_repo is not None:
        project.github_repo = data.github_repo.strip() if data.github_repo else None
    if data.github_token is not None and data.github_token.strip():
        project.github_token = data.github_token.strip()

    project.github_sync_enabled = data.github_sync_enabled
    
    db.add(models.AuditEvent(project_id=project.id, event_type="integration.github.updated"))
    await db.commit()
    await db.refresh(project)
    
    return {
        "github_repo": project.github_repo,
        "has_token": bool(project.github_token),
        "github_sync_enabled": bool(project.github_sync_enabled)
    }

@app.post('/api/projects/{slug}/github/test')
async def test_github_endpoint(
    slug: str,
    data: Optional[schemas.GitHubConfigRequest] = None,
    project: Project = Depends(auth.get_project_for_integration)
):
    """Test GitHub connection with provided token/repo or saved configuration."""
    repo = (data.github_repo if data and data.github_repo else project.github_repo) or ""
    token = (data.github_token if data and data.github_token else project.github_token) or ""
    
    if not repo or not token:
        raise HTTPException(status_code=400, detail="Необходимо указать репозиторий и Personal Access Token")
        
    res = await github_service.test_github_connection(repo, token)
    return res

@app.post('/api/projects/{slug}/github/sync', response_model=schemas.GitHubSyncResponse)
async def sync_all_github_tickets(
    slug: str,
    request: Request,
    project: Project = Depends(auth.get_project_for_integration),
    db: AsyncSession = Depends(get_db)
):
    """Sync all unsynced Vibus tickets to GitHub issues."""
    if not project.github_repo or not project.github_token:
        raise HTTPException(status_code=400, detail="GitHub не настроен для данного проекта. Укажите repo и token в настройках.")
        
    base_url = str(request.base_url).rstrip('/')
    res = await github_service.sync_project_tickets_to_github(db, project, base_url=base_url)
    return {
        "status": "success" if res.get("ok") else "error",
        "synced_count": res.get("synced_count", 0),
        "issues": res.get("issues", [])
    }

@app.post('/api/projects/{slug}/tickets/{ticket_id}/github/sync')
async def sync_single_ticket_to_github(
    slug: str,
    ticket_id: str,
    request: Request,
    project: Project = Depends(auth.get_project_for_integration),
    db: AsyncSession = Depends(get_db)
):
    """Sync a specific ticket to GitHub issue."""
    if not project.github_repo or not project.github_token:
        raise HTTPException(status_code=400, detail="GitHub не настроен для проекта")
        
    res = await db.execute(
        select(models.SpecTicket, models.SpecNode)
        .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
        .where(models.SpecTicket.id == ticket_id, models.SpecNode.project_id == project.id)
    )
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="Тикет не найден")
        
    ticket, node = row
    base_url = str(request.base_url).rstrip('/')
    gh_res = await github_service.create_github_issue_for_ticket(
        repo=project.github_repo,
        token=project.github_token,
        ticket=ticket,
        project_slug=project.slug,
        node_title=node.title if node else "General",
        base_url=base_url
    )
    if not gh_res.get("ok"):
        raise HTTPException(status_code=502, detail=gh_res.get("message", "Ошибка создания issue на GitHub"))
        
    ticket.github_issue_url = gh_res.get("issue_url")
    ticket.github_issue_number = gh_res.get("issue_number")
    await db.commit()
    await db.refresh(ticket)
    
    return {
        "status": "success",
        "github_url": ticket.github_issue_url,
        "github_number": ticket.github_issue_number
    }

# === MODEL CONTEXT PROTOCOL (MCP) REST & SSE BRIDGE ===

MCP_TOOL_DEFINITIONS = [
    {
        "name": "vibus_list_tickets",
        "description": "List bugs, tasks and feature requests collected by the Vibus widget for an AI agent.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "project_slug": {
                    "type": "string",
                    "description": "The project slug or ID (e.g. 'my_project' or 'demo-showcase')"
                },
                "status": {
                    "type": "string",
                    "description": "Filter by status: 'backlog', 'in_progress', 'review', 'done' or 'all'",
                    "default": "all"
                }
            },
            "required": ["project_slug"]
        }
    },
    {
        "name": "vibus_get_ticket_details",
        "description": "Get detailed information about a specific bug/ticket, including DOM selector, screenshot URL, user agent, viewport, and checklists.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "ticket_id": {
                    "type": "string",
                    "description": "The unique ID or key of the ticket (e.g. 'VB-1')"
                }
            },
            "required": ["ticket_id"]
        }
    },
    {
        "name": "vibus_update_ticket_status",
        "description": "Update the status of a Vibus ticket (e.g. mark as 'in_progress' while coding, or 'review' / 'done' after fixing).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "project_slug": {
                    "type": "string",
                    "description": "The project slug"
                },
                "ticket_id": {
                    "type": "string",
                    "description": "The ID of the ticket"
                },
                "status": {
                    "type": "string",
                    "enum": ["backlog", "in_progress", "review", "done"],
                    "description": "New status for the ticket"
                },
                "rework_notes": {
                    "type": "string",
                    "description": "Explanation of fix or implementation notes for reviewers"
                }
            },
            "required": ["project_slug", "ticket_id", "status"]
        }
    },
    {
        "name": "vibus_create_ticket",
        "description": "Create a new bug report or task on the Vibus Kanban board directly from AI assistant.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "project_slug": {
                    "type": "string",
                    "description": "The project slug"
                },
                "title": {
                    "type": "string",
                    "description": "Short title describing the task or bug"
                },
                "summary": {
                    "type": "string",
                    "description": "Detailed description, steps to reproduce or acceptance criteria"
                },
                "priority": {
                    "type": "string",
                    "enum": ["critical", "high", "medium", "low"],
                    "default": "medium"
                }
            },
            "required": ["project_slug", "title"]
        }
    },
    {
        "name": "vibus_sync_github",
        "description": "Sync all pending Vibus tickets to GitHub Issues in the connected GitHub repository.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "project_slug": {
                    "type": "string",
                    "description": "The project slug"
                }
            },
            "required": ["project_slug"]
        }
    }
]

@app.get('/api/mcp/tools')
async def list_mcp_tools():
    """List available MCP tools for AI Agents (Cursor, Claude, Antigravity, etc.)."""
    return {"tools": MCP_TOOL_DEFINITIONS}

@app.post("/api/mcp/execute")
async def execute_mcp_tool(
    request: Request,
    payload: dict = Body(...),
    principal: Any = Depends(lambda: None),
    db: AsyncSession = Depends(get_db)
):
    tool_name = payload.get("name")
    arguments = payload.get("arguments", {}) or {}
    
    project_slug = arguments.get("project_slug")
    if not project_slug:
        raise HTTPException(status_code=422, detail="project_slug is required")

    read_tools = {"vibus_list_tickets", "vibus_get_ticket_details"}
    write_tools = {"vibus_update_ticket_status", "vibus_create_ticket"}
    integration_tools = {"vibus_sync_github"}

    from settings import get_settings
    core_settings = get_settings()

    if (tool_name in write_tools or tool_name in integration_tools) and not core_settings.enable_mcp_write:
        raise HTTPException(status_code=403, detail="MCP write operations are disabled (enable_mcp_write=False)")

    if tool_name in integration_tools or tool_name == "vibus_sync_github":
        req_cap = "integration:manage"
    elif tool_name in write_tools:
        req_cap = "project:write"
    elif tool_name in read_tools:
        req_cap = "project:read"
    else:
        raise HTTPException(status_code=400, detail=f"Unknown tool '{tool_name}'")

    auth_header = request.headers.get("Authorization")
    x_api_token = request.headers.get("X-API-Token")
    
    proj = await auth.require_project_capability(
        slug=project_slug, 
        required_capability=req_cap, 
        token=None, 
        x_api_token=x_api_token, 
        authorization=auth_header, 
        db=db
    )

    if tool_name == "vibus_list_tickets":
        status_filter = arguments.get("status", "all")
        nodes = await crud.get_nodes_by_project(db, proj.id)
        all_tickets = []
        for node in nodes:
            for t in (node.tickets or []):
                if not t.is_deleted and (status_filter == "all" or t.status == status_filter):
                    all_tickets.append({
                        "id": t.id,
                        "key": t.key,
                        "title": t.title,
                        "summary": t.summary,
                        "status": t.status,
                        "priority": t.priority,
                        "assignee": t.assignee,
                        "node_title": node.title,
                        "github_issue": t.github_issue_url
                    })
        return {
            "content": [{"type": "text", "text": json.dumps(all_tickets, ensure_ascii=False, indent=2)}]
        }
        
    elif tool_name == "vibus_get_ticket_details":
        ticket_id = arguments.get("ticket_id")
        res = await db.execute(
            select(models.SpecTicket, models.SpecNode)
            .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
            .where(
                (models.SpecTicket.id == ticket_id) | (models.SpecTicket.key == ticket_id),
                models.SpecNode.project_id == proj.id
            )
        )
        row = res.first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Ticket '{ticket_id}' not found")
        ticket, node = row
        details = {
            "id": ticket.id,
            "key": ticket.key,
            "title": ticket.title,
            "summary": ticket.summary,
            "source_quote": ticket.source_quote,
            "status": ticket.status,
            "priority": ticket.priority,
            "assignee": ticket.assignee,
            "node": node.title,
            "bug_context": ticket.bug_context,
            "checklists": ticket.checklists,
            "rework_notes": ticket.rework_notes,
            "github_issue_url": ticket.github_issue_url,
            "github_issue_number": ticket.github_issue_number,
            "created_at": ticket.created_at.isoformat() if ticket.created_at else None
        }
        return {
            "content": [{"type": "text", "text": json.dumps(details, ensure_ascii=False, indent=2)}]
        }

    elif tool_name == "vibus_update_ticket_status":
        ticket_id = arguments.get("ticket_id")
        new_status = arguments.get("status")
        rework_notes = arguments.get("rework_notes")
        
        # Validates status enum -> 422 if invalid
        update_data = schemas.TicketUpdate(status=new_status)
        if rework_notes:
            update_data.rework_notes = rework_notes
            
        ticket = await crud.update_ticket(db, proj.id, ticket_id, update_data)
        if not ticket:
            raise HTTPException(status_code=404, detail=f"Ticket '{ticket_id}' not found")
            
        return {
            "content": [{"type": "text", "text": f"Ticket {ticket.key or ticket.id} successfully updated to status '{new_status}'"}]
        }

    elif tool_name == "vibus_create_ticket":
        title = arguments.get("title")
        summary = arguments.get("summary", "")
        priority = arguments.get("priority", "medium")
        
        nodes = await crud.get_nodes_by_project(db, proj.id)
        if not nodes:
            node = await crud.create_node(db, proj.id, schemas.NodeCreate(title="General", content_markdown="", parent_id=None))
        else:
            node = nodes[0]
            
        ticket_data = schemas.TicketCreate(
            title=title,
            summary=summary,
            priority=priority,
            status="backlog"
        )
        ticket = await crud.create_ticket(db, proj.id, node.id, ticket_data)
        
        return {
            "content": [{"type": "text", "text": f"Created ticket {ticket.key or ticket.id}: '{title}' in project {proj.slug}"}]
        }

    elif tool_name == "vibus_sync_github":
        if not proj.github_repo or not proj.github_token:
            raise HTTPException(status_code=400, detail="GitHub not configured for this project")

            
        base_url = str(request.base_url).rstrip('/')
        res = await github_service.sync_project_tickets_to_github(db, proj, base_url=base_url)
        return {
            "content": [{"type": "text", "text": f"GitHub sync completed. Synced {res.get('synced_count')} tickets."}]
        }

    raise HTTPException(status_code=400, detail=f"Unknown tool: {tool_name}")

# === WEBSOCKET ===

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, project_id: str):
        if project_id not in self.active_connections:
            self.active_connections[project_id] = []
        self.active_connections[project_id].append(websocket)

    def disconnect(self, websocket: WebSocket, project_id: str):
        if project_id in self.active_connections:
            if websocket in self.active_connections[project_id]:
                self.active_connections[project_id].remove(websocket)

    async def broadcast(self, message: dict, project_id: str, exclude: WebSocket = None):
        if project_id in self.active_connections:
            for connection in list(self.active_connections[project_id]):
                if connection != exclude:
                    try:
                        await connection.send_json(message)
                    except Exception as e:
                        logger.debug(f"Broadcast error on client: {e}")

manager = ConnectionManager()

@app.websocket('/ws/sync/{project_slug}')
async def websocket_endpoint(websocket: WebSocket, project_slug: str):
    await websocket.accept()

    # Preview reviewers authenticate with a host-only HttpOnly cookie on the
    # isolated preview origin. Normal API/CLI clients still authenticate with
    # the explicit first-message bearer token.
    project = None
    capabilities: list[str] = []
    fingerprint = websocket.headers.get("x-device-fingerprint")

    async with async_session() as db:
        preview_cookie = websocket.cookies.get(get_settings().preview_session_cookie_name)
        if preview_cookie:
            project, capabilities = await auth.resolve_preview_session_capabilities(
                db=db,
                slug=project_slug,
                raw_preview_session=preview_cookie,
            )

        if not project:
            try:
                init_raw = await websocket.receive_text()
                if len(init_raw) > 1_000_000:
                    await websocket.send_json({"type": "protocol.error", "code": "message_too_large"})
                    await websocket.close(code=1009)
                    return
                init_msg = json.loads(init_raw)
            except Exception:
                await websocket.close(code=1008, reason="Authentication required")
                return

            if init_msg.get("type") != "auth":
                await websocket.send_json({"type": "auth_required", "message": "Authentication required as first message"})
                await websocket.close(code=1008, reason="Authentication required")
                return

            token = init_msg.get("token")
            if not token:
                await websocket.send_json({"type": "auth_error", "message": "Missing token"})
                await websocket.close(code=1008, reason="Missing token")
                return

            fingerprint = init_msg.get("fingerprint") or fingerprint
            project, capabilities = await auth.resolve_project_token_capabilities(
                db=db,
                slug=project_slug,
                token=token,
                fingerprint=fingerprint,
            )

        if not project or project.slug != project_slug or "project:read" not in capabilities:
            await websocket.send_json({"type": "auth_error", "message": "Invalid credentials for this project"})
            await websocket.close(code=1008, reason="Invalid credentials")
            return

        project_id = project.id
        revision = getattr(project, 'revision', 0) or 0
        board = await crud.get_full_board(db, project_id)

    await manager.connect(websocket, project_id)
    await websocket.send_json({"type": "auth_ok", "capabilities": capabilities})
    await websocket.send_json({"type": "board.snapshot", "revision": revision, "data": board})

    ALLOWED_EVENT_KEYS = {"type", "event_id", "entity_id", "expected_revision", "payload"}

    try:
        while True:
            data = await websocket.receive_text()
            if len(data) > 1_000_000:
                await websocket.send_json({"type": "protocol.error", "code": "message_too_large"})
                await websocket.close(code=1009)
                return

            try:
                parsed = json.loads(data)
            except Exception:
                await websocket.send_json({"type": "protocol.error", "code": "invalid_envelope"})
                continue

            if not isinstance(parsed, dict):
                await websocket.send_json({"type": "protocol.error", "code": "invalid_envelope"})
                continue

            # Reject full board replacement
            if "nodes" in parsed and "slug" in parsed:
                await websocket.send_json({"type": "protocol.error", "code": "board_replace_forbidden"})
                continue

            # Check unknown envelope fields
            extra_keys = set(parsed.keys()) - ALLOWED_EVENT_KEYS
            if extra_keys:
                await websocket.send_json({"type": "protocol.error", "code": "validation_error"})
                continue

            ev_type = parsed.get("type")
            event_id = parsed.get("event_id")
            entity_id = parsed.get("entity_id")
            expected_rev = parsed.get("expected_revision")
            payload = parsed.get("payload")

            if not event_id:
                await websocket.send_json({"type": "protocol.error", "code": "validation_error"})
                continue

            if expected_rev is None:
                await websocket.send_json({"type": "protocol.error", "code": "validation_error"})
                continue

            if not ev_type or ev_type not in {"ticket.status.change", "ticket.comment.add", "ticket.checklist.change", "ticket.criteria.evidence"}:
                await websocket.send_json({"type": "protocol.error", "code": "unknown_event"})
                continue

            if ev_type == "ticket.comment.add":
                allowed_event = "ticket:comment" in capabilities
            elif ev_type == "ticket.status.change":
                allowed_event = "project:write" in capabilities or "ticket:review" in capabilities
            else:
                allowed_event = "project:write" in capabilities
            if not allowed_event:
                await websocket.send_json({"type": "event.error", "event_id": event_id, "code": "forbidden"})
                continue

            async with async_session() as db:
                # DB idempotency check via AuditEvent
                ev_lookup = await db.execute(
                    select(models.AuditEvent).where(
                        (models.AuditEvent.event_id == event_id) | (models.AuditEvent.event_type == f"ws.event:{event_id}")
                    )
                )
                if ev_lookup.scalar_one_or_none():
                    p_res_dup = await db.execute(select(models.Project).where(models.Project.id == project_id))
                    p_dup = p_res_dup.scalar_one_or_none()
                    dup_rev = getattr(p_dup, 'revision', 0) if p_dup else 0
                    await websocket.send_json({"type": "event.ack", "event_id": event_id, "duplicate": True, "revision": dup_rev})
                    continue

                p_res = await db.execute(select(models.Project).where(models.Project.id == project_id).with_for_update())
                proj = p_res.scalar_one_or_none()
                curr_rev = getattr(proj, 'revision', 0) or 0

                if expected_rev != curr_rev:
                    await websocket.send_json({"type": "event.error", "event_id": event_id, "code": "revision_conflict"})
                    continue

                # Process mutations
                if ev_type == "ticket.status.change":
                    new_status = payload.get("status") if isinstance(payload, dict) else None
                    if not new_status or new_status not in {"backlog", "in_progress", "review", "done"}:
                        await websocket.send_json({"type": "event.error", "event_id": event_id, "code": "validation_error"})
                        continue

                    t_res = await db.execute(
                        select(models.SpecTicket)
                        .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
                        .where(
                            models.SpecTicket.id == entity_id,
                            models.SpecNode.project_id == project_id,
                            models.SpecTicket.is_deleted == False
                        )
                    )
                    ticket = t_res.scalar_one_or_none()
                    if not ticket:
                        await websocket.send_json({"type": "event.error", "event_id": event_id, "code": "not_found"})
                        continue
                    if "project:write" not in capabilities:
                        if "ticket:review" not in capabilities or ticket.status not in {"review", "qa"} or new_status not in {"done", "in_progress"}:
                            await websocket.send_json({"type": "event.error", "event_id": event_id, "code": "forbidden"})
                            continue
                    if new_status == "review":
                        ready, missing = _criteria_auto_review_ready(ticket)
                        if not ready:
                            await websocket.send_json({
                                "type": "event.error", "event_id": event_id, "code": "criteria_unverified",
                                "missing_criteria": missing[:50],
                            })
                            continue
                    ticket.status = new_status
                    if isinstance(payload, dict) and "rework_notes" in payload:
                        ticket.rework_notes = str(payload.get("rework_notes") or "")[:10000]

                elif ev_type == "ticket.comment.add":
                    text = payload.get("text") if isinstance(payload, dict) else str(payload)
                    if not text or not str(text).strip():
                        await websocket.send_json({"type": "event.error", "event_id": event_id, "code": "validation_error"})
                        continue

                    t_res = await db.execute(
                        select(models.SpecTicket)
                        .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
                        .where(
                            models.SpecTicket.id == entity_id,
                            models.SpecNode.project_id == project_id,
                            models.SpecTicket.is_deleted == False
                        )
                    )
                    ticket = t_res.scalar_one_or_none()
                    if not ticket:
                        await websocket.send_json({"type": "event.error", "event_id": event_id, "code": "not_found"})
                        continue
                    comments = list(ticket.comments or [])
                    comments.append({"id": uuid.uuid4().hex[:8], "text": text, "created_at": datetime.now(timezone.utc).isoformat()})
                    ticket.comments = comments

                elif ev_type == "ticket.checklist.change":
                    key = payload.get("key") if isinstance(payload, dict) else None
                    if not key:
                        await websocket.send_json({"type": "event.error", "event_id": event_id, "code": "validation_error"})
                        continue
                    is_done = bool(payload.get("is_done", False))

                    t_res = await db.execute(
                        select(models.SpecTicket)
                        .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
                        .where(
                            models.SpecTicket.id == entity_id,
                            models.SpecNode.project_id == project_id,
                            models.SpecTicket.is_deleted == False
                        )
                    )
                    ticket = t_res.scalar_one_or_none()
                    if not ticket:
                        await websocket.send_json({"type": "event.error", "event_id": event_id, "code": "not_found"})
                        continue
                    checklists = dict(ticket.checklists or {})
                    checklists[key] = is_done
                    ticket.checklists = checklists
                    if not is_done:
                        evidence = dict(ticket.criteria_evidence or {})
                        evidence.pop(key, None)
                        ticket.criteria_evidence = evidence

                elif ev_type == "ticket.criteria.evidence":
                    t_res = await db.execute(
                        select(models.SpecTicket)
                        .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
                        .where(
                            models.SpecTicket.id == entity_id,
                            models.SpecNode.project_id == project_id,
                            models.SpecTicket.is_deleted == False
                        )
                    )
                    ticket = t_res.scalar_one_or_none()
                    if not ticket:
                        await websocket.send_json({"type": "event.error", "event_id": event_id, "code": "not_found"})
                        continue
                    raw_payload = payload if isinstance(payload, dict) else {}
                    key = str(raw_payload.get("key") or "").strip()
                    if not bool((ticket.checklists or {}).get(key)):
                        await websocket.send_json({"type": "event.error", "event_id": event_id, "code": "criterion_not_claimed"})
                        continue
                    contracts = dict(ticket.criteria_contract or {})
                    contract = contracts.get(key)
                    if not isinstance(contract, dict):
                        await websocket.send_json({"type": "event.error", "event_id": event_id, "code": "criterion_contract_missing"})
                        continue
                    try:
                        key, receipt = validated_machine_receipt(raw_payload, contract)
                    except ValueError as exc:
                        await websocket.send_json({"type": "event.error", "event_id": event_id, "code": "validation_error", "message": str(exc)})
                        continue
                    evidence = dict(ticket.criteria_evidence or {})
                    evidence[key] = receipt
                    ticket.criteria_evidence = evidence

                ticket.revision = (ticket.revision or 0) + 1
                proj.revision = curr_rev + 1
                db.add(models.AuditEvent(
                    event_id=event_id,
                    workspace_id=proj.workspace_id,
                    event_type=f"ws.event:{event_id}",
                    details={"project_id": project_id, "entity_id": entity_id, "type": ev_type}
                ))
                await db.commit()

                await websocket.send_json({"type": "event.ack", "event_id": event_id, "revision": proj.revision})

                await manager.broadcast({
                    "type": ev_type,
                    "event_id": event_id,
                    "entity_id": entity_id,
                    "payload": payload,
                    "revision": proj.revision
                }, project_id, exclude=websocket)

    except WebSocketDisconnect:
        manager.disconnect(websocket, project_id)
    except Exception as e:
        logger.error(f"WebSocket session error: {e}")
        manager.disconnect(websocket, project_id)

# ----------------------------------------------------
# LIVE PREVIEW TUNNEL GATEWAY (LOCAL SHARE)

@app.post('/api/projects/{slug}/tunnels')
async def create_tunnel_session(
    slug: str,
    data: schemas.TunnelIssueRequest,
    request: Request,
    project: models.Project = Depends(auth.get_project_for_settings),
    db: AsyncSession = Depends(get_db)
):
    from settings import get_settings
    core_settings = get_settings()
    if not core_settings.enable_public_tunnels:
        raise HTTPException(status_code=403, detail="Public preview tunnels are disabled (enable_public_tunnels=False)")

    if data.ttl == "forever":
        raise HTTPException(status_code=400, detail="Live preview tunnels do not support 'forever' TTL; use an explicit duration (24h, 7d, 30d)")

    import secrets
    tunnel_id = f"t-{secrets.token_urlsafe(18)}"
    connector_secret = f"ts_{secrets.token_urlsafe(32)}"
    secret_digest = security.hash_access_token(connector_secret)

    # Issue a temporary ProjectAccessLink credential for the reviewer
    link_data = schemas.AccessLinkCreate(
        role=schemas.RoleEnum(data.role) if data.role in ("viewer", "reviewer", "team", "tester") else schemas.RoleEnum.reviewer,
        ttl=schemas.TtlEnum(data.ttl) if data.ttl in ("24h", "7d", "30d") else schemas.TtlEnum.d7,
        single_use=bool(data.single_use),
        label=f"Tunnel preview {tunnel_id}"
    )
    access_link, raw_access_token = await crud.create_access_link(db, project.id, link_data)

    expires_at = access_link.expires_at or (models.utcnow() + timedelta(days=7))

    record = models.TunnelSession(
        tunnel_id=tunnel_id,
        project_id=project.id,
        connect_token_digest=secret_digest,
        target_port=data.target_port,
        expires_at=expires_at,
        is_connected=False
    )
    db.add(record)
    await db.commit()

    preview_base_url = str(getattr(core_settings, 'preview_base_url', 'http://localhost:8000')).rstrip('/')
    preview_url = f"{preview_base_url}/preview/{tunnel_id}#vibus_token={raw_access_token}"
    return {
        "tunnel_id": tunnel_id,
        "connector_secret": connector_secret,
        "preview_url": preview_url,
        "expires_at": expires_at.isoformat()
    }

# ----------------------------------------------------

@app.websocket('/ws/tunnel/{tunnel_id}')
async def websocket_tunnel_endpoint(
    websocket: WebSocket, 
    tunnel_id: str
):
    await websocket.accept()

    try:
        first_raw = await websocket.receive_text()
        if len(first_raw) > 65536:
            await websocket.close(code=1009, reason="First frame too large")
            return
        first_msg = json.loads(first_raw)
    except Exception:
        await websocket.close(code=1008, reason="Authentication required")
        return

    if first_msg.get("type") != "tunnel.authenticate":
        await websocket.send_json({"type": "auth_required", "message": "Authentication required"})
        await websocket.close(code=1008, reason="Authentication required")
        return

    connector_secret = first_msg.get("connector_secret")
    if not connector_secret:
        await websocket.send_json({"type": "auth_error", "message": "Missing connector secret"})
        await websocket.close(code=1008, reason="Missing connector secret")
        return

    secret_digest = security.hash_access_token(connector_secret)

    async with async_session() as db:
        res = await db.execute(
            select(models.TunnelSession)
            .where(
                models.TunnelSession.tunnel_id == tunnel_id,
                models.TunnelSession.is_connected == False
            )
            .with_for_update()
        )
        record = res.scalar_one_or_none()
        if not record:
            check_res = await db.execute(
                select(models.TunnelSession).where(models.TunnelSession.tunnel_id == tunnel_id)
            )
            existing = check_res.scalar_one_or_none()
            if existing and existing.connect_token_digest == secret_digest:
                await websocket.send_json({"type": "auth_error", "code": "secret_already_used", "message": "Connector secret has already been used"})
                await websocket.close(code=1008, reason="Secret already used")
                return
            await websocket.send_json({"type": "auth_error", "message": "Invalid connector secret"})
            await websocket.close(code=1008, reason="Invalid connector secret")
            return

        if record.connect_token_digest != secret_digest:
            await websocket.send_json({"type": "auth_error", "message": "Invalid connector secret"})
            await websocket.close(code=1008, reason="Invalid connector secret")
            return

        now = datetime.now(timezone.utc)
        exp = record.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)

        if exp < now:
            await websocket.send_json({"type": "auth_error", "code": "tunnel_expired", "message": "Tunnel has expired"})
            await websocket.close(code=1008, reason="Tunnel expired")
            return

        if record.is_connected:
            await websocket.send_json({
                "type": "auth_error",
                "code": "secret_already_used",
                "message": "Connector secret is single use and already active"
            })
            await websocket.close(code=4409, reason="Connector secret already used")
            return

        record.is_connected = True
        await db.commit()
        project_id = record.project_id
        target_port = record.target_port

    session = await tunnel_gateway.register_tunnel(tunnel_id, websocket, project_id, target_port)
    try:
        while True:
            raw_msg = await websocket.receive_text()
            if len(raw_msg.encode('utf-8')) > MAX_TUNNEL_WS_FRAME_BYTES:
                logger.warning("Tunnel frame too large: tunnel=%s", tunnel_id)
                await websocket.close(code=1009, reason="Tunnel frame too large")
                return
            await tunnel_gateway.handle_cli_message(tunnel_id, raw_msg)
    except WebSocketDisconnect:
        tunnel_gateway.unregister_tunnel(tunnel_id)
    except Exception as e:
        logger.error(f"Tunnel session error on {tunnel_id}: {e}")
        tunnel_gateway.unregister_tunnel(tunnel_id)


def _preview_bootstrap_response(tunnel_id: str) -> HTMLResponse:
    """Minimal trusted bootstrap that exchanges a fragment capability for a
    host-only HttpOnly preview session before any untrusted localhost HTML runs.
    """
    import secrets
    nonce = secrets.token_urlsafe(18)
    tunnel_json = json.dumps(tunnel_id)
    html = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VibeUs Preview</title>
<style>html{{color-scheme:dark}}body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#07070a;color:#f4f2ff;font:14px system-ui,sans-serif}}.c{{max-width:520px;padding:28px;border:1px solid #ffffff18;border-radius:20px;background:#101118}}small{{color:#8b8e9b}}</style>
</head><body><div class="c"><strong>VibeUs Live Preview</strong><p id="status">Проверяем ссылку доступа…</p><small>Не вводите на тестовом стенде реальные пароли, банковские данные и секреты.</small></div>
<script nonce="{nonce}">
(async () => {{
  const status = document.getElementById('status');
  const params = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : '');
  const token = params.get('vibus_token') || params.get('vibus-access') || params.get('access_token');
  if (!token) {{ status.textContent = 'Ссылка доступа отсутствует или уже очищена. Откройте исходную ссылку VibeUs повторно.'; return; }}
  let fingerprint = sessionStorage.getItem('vibeus_preview_fingerprint');
  if (!fingerprint) {{
    fingerprint = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    sessionStorage.setItem('vibeus_preview_fingerprint', fingerprint);
  }}
  try {{
    const res = await fetch('/api/preview/sessions/exchange', {{
      method: 'POST', credentials: 'include', headers: {{'Content-Type':'application/json'}},
      body: JSON.stringify({{tunnel_id: {tunnel_json}, token, fingerprint}})
    }});
    if (!res.ok) throw new Error((await res.json().catch(()=>({{}}))).detail || 'Ссылка недействительна');
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  }} catch (e) {{ status.textContent = 'Не удалось открыть стенд: ' + (e && e.message ? e.message : 'ошибка доступа'); }}
}})();
</script></body></html>"""
    return HTMLResponse(
        html,
        headers={
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": f"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
            "X-Content-Type-Options": "nosniff",
        },
    )


async def _get_preview_session(request: Request, tunnel_id: str, db: AsyncSession) -> Optional[models.PreviewSession]:
    from settings import get_settings
    raw_session = request.cookies.get(get_settings().preview_session_cookie_name)
    if not raw_session:
        return None
    digest = security.hash_access_token(raw_session)
    result = await db.execute(
        select(models.PreviewSession).where(
            models.PreviewSession.session_digest == digest,
            models.PreviewSession.tunnel_id == tunnel_id,
        )
    )
    preview_session = result.scalar_one_or_none()
    if not preview_session or preview_session.revoked_at:
        return None
    if preview_session.expires_at <= models.utcnow():
        return None
    return preview_session


@app.post('/api/preview/sessions/exchange', response_model=schemas.PreviewSessionExchangeResponse)
@limiter.limit("30/minute")
async def exchange_preview_session(
    request: Request,
    response: Response,
    data: schemas.PreviewSessionExchangeRequest,
    db: AsyncSession = Depends(get_db),
):
    from settings import get_settings
    settings = get_settings()
    now = models.utcnow()

    tunnel_res = await db.execute(
        select(models.TunnelSession)
        .where(models.TunnelSession.tunnel_id == data.tunnel_id)
        .with_for_update()
    )
    tunnel = tunnel_res.scalar_one_or_none()
    if not tunnel or tunnel.status not in {"active", None} or tunnel.expires_at <= now:
        raise HTTPException(status_code=404, detail="Preview tunnel is unavailable or expired")

    token_digest = security.hash_access_token(data.token)
    link_res = await db.execute(
        select(models.ProjectAccessLink)
        .where(models.ProjectAccessLink.token_hash == token_digest)
        .with_for_update()
    )
    link = link_res.scalar_one_or_none()
    if not link or link.project_id != tunnel.project_id:
        raise HTTPException(status_code=403, detail="Preview access token does not belong to this tunnel")
    if link.expires_at and link.expires_at <= now:
        raise HTTPException(status_code=403, detail="Preview access link expired")

    if link.single_use:
        if link.is_activated:
            if not data.fingerprint or link.activated_fingerprint != data.fingerprint:
                raise HTTPException(status_code=403, detail="Single-use preview link has already been activated")
        else:
            link.is_activated = True
            link.activated_fingerprint = data.fingerprint
            link.activated_at = now

    project_res = await db.execute(select(models.Project).where(models.Project.id == tunnel.project_id))
    project = project_res.scalar_one_or_none()
    if not project or project.is_deleted:
        raise HTTPException(status_code=404, detail="Project not found")

    raw_preview_session, preview_digest = security.create_access_token()
    expires_at = min(tunnel.expires_at, link.expires_at) if link.expires_at else tunnel.expires_at
    db.add(models.PreviewSession(
        session_digest=preview_digest,
        tunnel_id=tunnel.tunnel_id,
        access_link_id=link.id,
        expires_at=expires_at,
    ))
    await db.commit()

    max_age = max(1, int((expires_at - now).total_seconds()))
    response.set_cookie(
        key=settings.preview_session_cookie_name,
        value=raw_preview_session,
        max_age=max_age,
        httponly=True,
        secure=settings.environment in {"staging", "production", "quality_gate"},
        samesite="lax",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return schemas.PreviewSessionExchangeResponse(
        ok=True,
        project_slug=project.slug,
        role=link.role,
        expires_at=expires_at,
    )


@app.api_route('/preview/{tunnel_id}/{path:path}', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])
@app.api_route('/preview/{tunnel_id}', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])
async def preview_proxy_endpoint(request: Request, tunnel_id: str, path: str = '', db: AsyncSession = Depends(get_db)):
    """Authenticated HTTP reverse proxy to the developer's localhost."""
    preview_session = await _get_preview_session(request, tunnel_id, db)
    if not preview_session:
        if request.method == "GET" and not path:
            return _preview_bootstrap_response(tunnel_id)
        raise HTTPException(status_code=401, detail="Preview session required")

    # This route is path-prefix mode, not subdomain mode. Rewriting is required
    # so root-relative assets and SPA navigation stay inside the tunnel prefix.
    return await tunnel_gateway.proxy_http_request(tunnel_id, request, path, is_subdomain=False)


# Mount static files for widget bundle (if dist directory exists)
widget_dist = os.path.join(os.path.dirname(__file__), 'static')
if os.path.exists(widget_dist):
    app.mount('/static', StaticFiles(directory=widget_dist), name='static')