import os
from fastapi import Header, Query, HTTPException, Depends, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional, List
from datetime import datetime, timezone
from database import get_db
import crud
from models import Project, Workspace, WorkspaceMembership, User, ProjectAccessLink, PreviewSession, TunnelSession, Session, utcnow
from security import hash_access_token
from settings import get_settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=False)

ROLE_CAPABILITIES_MATRIX = {
    "owner": ["workspace:read", "workspace:manage", "workspace:billing", "project:read", "project:write", "ticket:comment", "ticket:review", "settings:manage", "integration:manage"],
    "admin": ["workspace:read", "workspace:manage", "project:read", "project:write", "ticket:comment", "ticket:review", "settings:manage", "integration:manage"],
    "member": ["workspace:read", "project:read", "project:write", "ticket:comment", "ticket:review"],
    "team": ["workspace:read", "project:read", "project:write", "ticket:comment", "ticket:review"],
    "tester": ["workspace:read", "project:read", "ticket:comment", "ticket:review"],
    "reviewer": ["workspace:read", "project:read", "ticket:comment", "ticket:review"],
    "viewer": ["workspace:read", "project:read"],
}

async def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    authorization: Optional[str] = Header(None, alias='Authorization'),
    db: AsyncSession = Depends(get_db)
) -> User:
    if not token and authorization and authorization.startswith('Bearer '):
        token = authorization.split(' ', 1)[1].strip()

    # Browser sessions use a host-only HttpOnly cookie. Bearer tokens remain
    # supported for API/CLI clients, but browser code no longer persists them.
    if not token:
        from settings import get_settings
        token = request.cookies.get(get_settings().browser_session_cookie_name)

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    hashed_token = hash_access_token(token)
    
    res = await db.execute(select(Session).where(Session.token == hashed_token))
    session = res.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=401, detail="Invalid token")
        
    now = datetime.now(timezone.utc)
    
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
        
    revoked_at = session.revoked_at
    if revoked_at and revoked_at.tzinfo is None:
        revoked_at = revoked_at.replace(tzinfo=timezone.utc)
        
    if revoked_at or expires_at < now:
        raise HTTPException(status_code=401, detail="Token expired or revoked")
        
    res = await db.execute(select(User).where(User.id == session.user_id))
    user = res.scalar_one_or_none()
    
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
        
    return user

async def require_workspace_capability(
    workspace_id: str,
    required_capability: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> Workspace:
    res = await db.execute(
        select(WorkspaceMembership)
        .where(WorkspaceMembership.workspace_id == workspace_id)
        .where(WorkspaceMembership.user_id == user.id)
    )
    membership = res.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Workspace not found")
        
    allowed_caps = ROLE_CAPABILITIES_MATRIX.get(membership.role, [])
    if required_capability not in allowed_caps:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    
    res = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace = res.scalar_one_or_none()
    return workspace

async def get_project_by_token(
    slug: str,
    request: Request,
    x_api_token: Optional[str] = Header(
        None,
        alias="X-API-Token",
    ),
    authorization: Optional[str] = Header(
        None,
        alias="Authorization",
    ),
    x_device_fingerprint: Optional[str] = Header(
        None,
        alias="X-Device-Fingerprint",
    ),
    db: AsyncSession = Depends(get_db),
) -> Project:
    return await require_project_capability(
        slug=slug,
        required_capability="project:write",
        token=None,
        x_api_token=x_api_token,
        authorization=authorization,
        x_device_fingerprint=x_device_fingerprint,
        preview_session_cookie=request.cookies.get(get_settings().preview_session_cookie_name),
        db=db,
    )


async def get_project_for_comment(
    slug: str,
    request: Request,
    x_api_token: Optional[str] = Header(None, alias="X-API-Token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_device_fingerprint: Optional[str] = Header(None, alias="X-Device-Fingerprint"),
    db: AsyncSession = Depends(get_db),
) -> Project:
    return await require_project_capability(
        slug=slug,
        required_capability="ticket:comment",
        token=None,
        x_api_token=x_api_token,
        authorization=authorization,
        x_device_fingerprint=x_device_fingerprint,
        preview_session_cookie=request.cookies.get(get_settings().preview_session_cookie_name),
        db=db,
    )


async def get_project_for_review(
    slug: str,
    request: Request,
    x_api_token: Optional[str] = Header(None, alias="X-API-Token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_device_fingerprint: Optional[str] = Header(None, alias="X-Device-Fingerprint"),
    db: AsyncSession = Depends(get_db),
) -> Project:
    return await require_project_capability(
        slug=slug,
        required_capability="ticket:review",
        token=None,
        x_api_token=x_api_token,
        authorization=authorization,
        x_device_fingerprint=x_device_fingerprint,
        preview_session_cookie=request.cookies.get(get_settings().preview_session_cookie_name),
        db=db,
    )


async def get_project_for_settings(
    slug: str,
    request: Request,
    x_api_token: Optional[str] = Header(
        None,
        alias="X-API-Token",
    ),
    authorization: Optional[str] = Header(
        None,
        alias="Authorization",
    ),
    x_device_fingerprint: Optional[str] = Header(
        None,
        alias="X-Device-Fingerprint",
    ),
    db: AsyncSession = Depends(get_db),
) -> Project:
    return await require_project_capability(
        slug=slug,
        required_capability="settings:manage",
        token=None,
        x_api_token=x_api_token,
        authorization=authorization,
        x_device_fingerprint=x_device_fingerprint,
        preview_session_cookie=request.cookies.get(get_settings().preview_session_cookie_name),
        db=db,
    )


async def get_project_for_integration(
    slug: str,
    request: Request,
    x_api_token: Optional[str] = Header(
        None,
        alias="X-API-Token",
    ),
    authorization: Optional[str] = Header(
        None,
        alias="Authorization",
    ),
    x_device_fingerprint: Optional[str] = Header(
        None,
        alias="X-Device-Fingerprint",
    ),
    db: AsyncSession = Depends(get_db),
) -> Project:
    return await require_project_capability(
        slug=slug,
        required_capability="integration:manage",
        token=None,
        x_api_token=x_api_token,
        authorization=authorization,
        x_device_fingerprint=x_device_fingerprint,
        preview_session_cookie=request.cookies.get(get_settings().preview_session_cookie_name),
        db=db,
    )

async def get_workspace_by_key(
    workspace_id: str,
    x_workspace_key: Optional[str] = Header(None, alias='X-Workspace-Key'),
    authorization: Optional[str] = Header(None, alias='Authorization'),
    db: AsyncSession = Depends(get_db)
):
    key = x_workspace_key
    if not key and authorization:
        if authorization.startswith('Bearer '):
            key = authorization.split(' ', 1)[1].strip()
        else:
            key = authorization.strip()
    
    ws = await crud.get_workspace_by_id(db, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
        
    if not key:
        raise HTTPException(status_code=403, detail="Invalid workspace API key")
    
    key_digest = hash_access_token(key)
    ws_key_digest = ws.api_key_digest
    if not ws_key_digest or key_digest != ws_key_digest:
        raise HTTPException(status_code=403, detail="Invalid workspace API key")
    return ws

async def get_project_public(
    slug: str,
    db: AsyncSession = Depends(get_db)
) -> Project:
    project = await crud.get_project_by_slug(db, slug)
    if not project:
        raise HTTPException(status_code=404, detail='Project not found')
    return project

async def resolve_project_token_capabilities(
    db: AsyncSession,
    slug: str,
    token: str,
    fingerprint: Optional[str] = None
) -> tuple[Optional[Project], list[str]]:
    if not token:
        return None, []

    # 1. Direct project owner API token
    project = await crud.get_project_by_token(db, token)
    if project and project.slug == slug:
        return project, ["project:read", "project:write", "ticket:comment", "ticket:review", "settings:manage", "integration:manage"]

    # 2. Access Link token (delegating to atomic helper)
    verified = await crud.verify_and_consume_access_link(db, token=token, fingerprint=fingerprint)
    if verified and verified.valid and verified.project_slug == slug:
        proj = await crud.get_project_by_slug(db, slug)
        if proj:
            role = verified.role or 'reviewer'
            allowed_caps = ROLE_CAPABILITIES_MATRIX.get(role, ["project:read"])
            return proj, list(allowed_caps)


    # 3. User Session token
    hashed_token = hash_access_token(token)
    res_sess = await db.execute(select(Session).where(Session.token == hashed_token))

    session = res_sess.scalar_one_or_none()
    if session:
        now = datetime.now(timezone.utc)
        expires_at = session.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        revoked_at = session.revoked_at
        if revoked_at and revoked_at.tzinfo is None:
            revoked_at = revoked_at.replace(tzinfo=timezone.utc)
        if not revoked_at and expires_at >= now:
            proj = await crud.get_project_by_slug(db, slug)
            if proj and proj.workspace_id:
                res_mem = await db.execute(
                    select(WorkspaceMembership)
                    .where(WorkspaceMembership.workspace_id == proj.workspace_id)
                    .where(WorkspaceMembership.user_id == session.user_id)
                )
                mem = res_mem.scalar_one_or_none()
                if mem:
                    allowed_caps = ROLE_CAPABILITIES_MATRIX.get(mem.role, ["project:read"])
                    return proj, list(allowed_caps)

    return None, []

async def resolve_preview_session_capabilities(
    db: AsyncSession,
    slug: str,
    raw_preview_session: Optional[str],
) -> tuple[Optional[Project], list[str]]:
    """Resolve an HttpOnly preview-session cookie to project-scoped capabilities.

    The browser never receives the original access-link bearer after exchange.
    A preview session is intentionally non-transferable from JavaScript and is
    bound to one tunnel/access-link/project plus the shortest expiry.
    """
    if not raw_preview_session:
        return None, []

    digest = hash_access_token(raw_preview_session)
    now = utcnow()
    result = await db.execute(
        select(PreviewSession, ProjectAccessLink, TunnelSession, Project)
        .join(ProjectAccessLink, ProjectAccessLink.id == PreviewSession.access_link_id)
        .join(TunnelSession, TunnelSession.tunnel_id == PreviewSession.tunnel_id)
        .join(Project, Project.id == ProjectAccessLink.project_id)
        .where(
            PreviewSession.session_digest == digest,
            PreviewSession.revoked_at.is_(None),
            PreviewSession.expires_at > now,
            TunnelSession.project_id == Project.id,
            TunnelSession.expires_at > now,
            Project.slug == slug,
            Project.is_deleted.is_(False),
        )
    )
    row = result.first()
    if not row:
        return None, []

    _preview, link, _tunnel, project = row
    if link.expires_at and link.expires_at <= now:
        return None, []

    role = link.role or "reviewer"
    return project, list(ROLE_CAPABILITIES_MATRIX.get(role, ["project:read"]))


async def require_project_capability(
    slug: str,
    required_capability: str,
    token: Optional[str] = None,
    x_api_token: Optional[str] = Header(None, alias='X-API-Token'),
    authorization: Optional[str] = Header(None, alias='Authorization'),
    x_device_fingerprint: Optional[str] = Header(None, alias='X-Device-Fingerprint'),
    preview_session_cookie: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
) -> Project:
    x_token_str = x_api_token if isinstance(x_api_token, str) else None
    token_str = token if isinstance(token, str) else None
    auth_str = authorization if isinstance(authorization, str) else None
    fingerprint = x_device_fingerprint if isinstance(x_device_fingerprint, str) else None

    api_token = x_token_str or token_str
    if not api_token and auth_str:
        if auth_str.startswith('Bearer '):
            api_token = auth_str.split(' ', 1)[1].strip()
        else:
            api_token = auth_str.strip()

    proj: Optional[Project] = None
    caps: list[str] = []
    if api_token:
        proj, caps = await resolve_project_token_capabilities(db, slug, api_token, fingerprint)
    elif preview_session_cookie:
        proj, caps = await resolve_preview_session_capabilities(db, slug, preview_session_cookie)
    else:
        raise HTTPException(status_code=401, detail="Authentication required")

    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    if required_capability not in caps:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    return proj


async def authenticate_mcp_principal(
    x_api_token: Optional[str] = Header(None, alias='X-API-Token'),
    authorization: Optional[str] = Header(None, alias='Authorization'),
) -> dict:
    return {"token": x_api_token or authorization}

