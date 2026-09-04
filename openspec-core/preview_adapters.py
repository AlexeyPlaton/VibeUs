from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import Column, DateTime, ForeignKey, String, Text, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

import auth
import models
from database import async_session, get_db
from security import decrypt_field, encrypt_field

router = APIRouter(tags=["preview-adapters"])
logger = logging.getLogger("vibeus.preview_adapters")
VERCEL_API_BASE = "https://api.vercel.com"
RENDER_API_BASE = "https://api.render.com"


class ProjectPreviewConfig(models.Base):
    __tablename__ = "project_preview_configs"

    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    provider = Column(String(32), nullable=False, default="github")
    provider_project_id = Column(String(255), nullable=True)
    provider_scope_id = Column(String(255), nullable=True)
    review_url = Column(String(2048), nullable=True)
    api_token_encrypted = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=models.utcnow)
    updated_at = Column(DateTime, nullable=False, default=models.utcnow, onupdate=models.utcnow)

    @property
    def api_token(self) -> Optional[str]:
        return decrypt_field(self.api_token_encrypted)

    @api_token.setter
    def api_token(self, value: Optional[str]) -> None:
        self.api_token_encrypted = encrypt_field(value) if value else None


class PreviewConfigUpdate(BaseModel):
    provider: Literal["github", "vercel", "render", "disabled"] = "github"
    provider_project_id: Optional[str] = Field(default=None, max_length=255)
    provider_scope_id: Optional[str] = Field(default=None, max_length=255)
    review_url: Optional[str] = Field(default=None, max_length=2048)
    api_token: Optional[str] = Field(default=None, max_length=4096)
    clear_token: bool = False

    @field_validator("provider_project_id", "provider_scope_id")
    @classmethod
    def strip_optional_identifier(cls, value: Optional[str]) -> Optional[str]:
        text = (value or "").strip()
        return text or None

    @field_validator("review_url")
    @classmethod
    def validate_review_url(cls, value: Optional[str]) -> Optional[str]:
        text = (value or "").strip()
        if not text:
            return None
        if not text.startswith(("https://", "http://")):
            raise ValueError("review_url must use http or https")
        return text


async def _account_project(
    slug: str,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
) -> models.Project:
    result = await db.execute(
        select(models.Project, models.WorkspaceMembership)
        .join(models.WorkspaceMembership, models.WorkspaceMembership.workspace_id == models.Project.workspace_id)
        .where(
            models.Project.slug == slug,
            models.Project.is_deleted.is_(False),
            models.WorkspaceMembership.user_id == user.id,
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    project, membership = row
    if "integration:manage" not in auth.ROLE_CAPABILITIES_MATRIX.get(membership.role, []):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return project


async def _get_config(db: AsyncSession, project_id: str, *, create: bool = False) -> Optional[ProjectPreviewConfig]:
    config = await db.get(ProjectPreviewConfig, project_id)
    if config or not create:
        return config
    config = ProjectPreviewConfig(project_id=project_id, provider="github")
    db.add(config)
    await db.flush()
    return config


def _payload(config: Optional[ProjectPreviewConfig]) -> dict[str, Any]:
    if not config:
        return {
            "provider": "github",
            "provider_project_id": None,
            "provider_scope_id": None,
            "review_url": None,
            "has_api_token": False,
            "observe_only": True,
        }
    return {
        "provider": config.provider,
        "provider_project_id": config.provider_project_id,
        "provider_scope_id": config.provider_scope_id,
        "review_url": config.review_url,
        "has_api_token": bool(config.api_token_encrypted),
        "observe_only": True,
    }


def _https_url(raw: Any) -> Optional[str]:
    value = str(raw or "").strip()
    if not value:
        return None
    if value.startswith(("https://", "http://")):
        return value[:2048]
    if "/" in value or "." in value:
        return f"https://{value}"[:2048]
    return None


def vercel_preview_url(payload: Any, head_sha: str) -> Optional[str]:
    deployments = payload.get("deployments", []) if isinstance(payload, dict) else []
    for deployment in deployments:
        if not isinstance(deployment, dict):
            continue
        state = str(deployment.get("readyState") or deployment.get("state") or "").upper()
        target = str(deployment.get("target") or "").lower()
        meta = deployment.get("meta") if isinstance(deployment.get("meta"), dict) else {}
        git_source = deployment.get("gitSource") if isinstance(deployment.get("gitSource"), dict) else {}
        shas = {
            str(meta.get("githubCommitSha") or "").lower(),
            str(meta.get("gitCommitSha") or "").lower(),
            str(git_source.get("sha") or "").lower(),
        }
        if state == "READY" and target != "production" and head_sha.lower() in shas:
            return _https_url(deployment.get("url"))
    return None


def render_deploy_matches(payload: Any, head_sha: str) -> bool:
    rows = payload if isinstance(payload, list) else []
    for row in rows:
        deployment = row.get("deploy") if isinstance(row, dict) and isinstance(row.get("deploy"), dict) else row
        if not isinstance(deployment, dict):
            continue
        commit = deployment.get("commit")
        commit_id = commit.get("id") if isinstance(commit, dict) else commit
        if str(deployment.get("status") or "").lower() == "live" and str(commit_id or "").lower() == head_sha.lower():
            return True
    return False


async def _vercel_deployments(config: ProjectPreviewConfig, *, limit: int = 20) -> Any:
    token = config.api_token
    if not token or not config.provider_project_id:
        raise HTTPException(status_code=409, detail="Vercel project ID and API token are required")
    params: dict[str, Any] = {"projectId": config.provider_project_id, "limit": limit}
    if config.provider_scope_id:
        params["teamId"] = config.provider_scope_id
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{VERCEL_API_BASE}/v6/deployments",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Vercel API request failed") from exc
    if response.status_code < 200 or response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"Vercel API rejected the request ({response.status_code})")
    return response.json()


async def _render_request(config: ProjectPreviewConfig, path: str) -> Any:
    token = config.api_token
    if not token or not config.provider_project_id:
        raise HTTPException(status_code=409, detail="Render service ID and API token are required")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{RENDER_API_BASE}{path}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Render API request failed") from exc
    if response.status_code < 200 or response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"Render API rejected the request ({response.status_code})")
    return response.json()


async def discover_preview_for_project(
    project: Any,
    head_sha: str,
    github_fallback: Callable[[], Awaitable[Optional[str]]],
) -> Optional[str]:
    if not getattr(project, "id", None):
        return await github_fallback()
    try:
        async with async_session() as db:
            config = await db.get(ProjectPreviewConfig, project.id)
    except SQLAlchemyError:
        logger.warning("Preview adapter table unavailable; falling back to GitHub Deployments", exc_info=True)
        return await github_fallback()
    if not config or config.provider == "github":
        return await github_fallback()
    if config.provider == "disabled":
        return None
    try:
        if config.provider == "vercel":
            return vercel_preview_url(await _vercel_deployments(config), head_sha)
        if config.provider == "render":
            if not config.review_url:
                return None
            payload = await _render_request(config, f"/v1/services/{config.provider_project_id}/deploys?limit=20")
            return config.review_url[:2048] if render_deploy_matches(payload, head_sha) else None
    except HTTPException:
        logger.info("Preview provider observation failed for project %s", getattr(project, "id", "unknown"), exc_info=True)
    return None


@router.get("/api/projects/{slug}/automation/preview")
async def get_preview_config(
    slug: str,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    return _payload(await _get_config(db, project.id))


@router.put("/api/projects/{slug}/automation/preview")
async def update_preview_config(
    slug: str,
    data: PreviewConfigUpdate,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    if data.provider == "vercel" and not data.provider_project_id:
        raise HTTPException(status_code=422, detail="Vercel project ID is required")
    if data.provider == "render" and (not data.provider_project_id or not data.review_url):
        raise HTTPException(status_code=422, detail="Render service ID and explicit review URL are required")
    config = await _get_config(db, project.id, create=True)
    assert config is not None
    config.provider = data.provider
    config.provider_project_id = data.provider_project_id
    config.provider_scope_id = data.provider_scope_id
    config.review_url = data.review_url
    if data.clear_token:
        config.api_token = None
    elif data.api_token is not None and data.api_token.strip():
        config.api_token = data.api_token.strip()
    db.add(models.AuditEvent(
        workspace_id=project.workspace_id,
        project_id=project.id,
        event_type="automation.preview_provider_updated",
        details={"provider": config.provider, "observe_only": True},
    ))
    await db.commit()
    return _payload(config)


@router.post("/api/projects/{slug}/automation/preview/test")
async def test_preview_config(
    slug: str,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    config = await _get_config(db, project.id)
    provider = config.provider if config else "github"
    if provider == "github":
        return {"ok": True, "provider": "github", "observe_only": True}
    if provider == "disabled":
        return {"ok": True, "provider": "disabled", "observe_only": True}
    assert config is not None
    if provider == "vercel":
        await _vercel_deployments(config, limit=1)
        return {"ok": True, "provider": "vercel", "observe_only": True}
    if provider == "render":
        await _render_request(config, f"/v1/services/{config.provider_project_id}")
        return {"ok": True, "provider": "render", "observe_only": True}
    raise HTTPException(status_code=422, detail="Unsupported preview provider")
