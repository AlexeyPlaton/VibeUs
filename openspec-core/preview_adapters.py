from __future__ import annotations

import logging
import re
from typing import Any, Awaitable, Callable, Literal, Optional
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import Column, DateTime, ForeignKey, String, Text, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

import auth
import github_app_auth
import models
from ai_orchestration_models import TicketAutomationState
from database import async_session, get_db
from security import decrypt_field, encrypt_field

router = APIRouter(tags=["preview-adapters"])
logger = logging.getLogger("vibeus.preview_adapters")
VERCEL_API_BASE = "https://api.vercel.com"
SHA_RE = re.compile(r"^[0-9a-f]{40}$", re.IGNORECASE)


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
    provider = config.provider if config else "github"
    return {
        "provider": provider,
        "provider_project_id": config.provider_project_id if config else None,
        "provider_scope_id": config.provider_scope_id if config else None,
        "review_url": config.review_url if config else None,
        "has_api_token": bool(config.api_token_encrypted) if config else False,
        "observe_only": True,
        "safe_preview_request_supported": provider != "disabled",
        "production_deploy_allowed": False,
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
        target = deployment.get("target")
        meta = deployment.get("meta") if isinstance(deployment.get("meta"), dict) else {}
        git_source = deployment.get("gitSource") if isinstance(deployment.get("gitSource"), dict) else {}
        shas = {
            str(meta.get("githubCommitSha") or "").lower(),
            str(meta.get("gitCommitSha") or "").lower(),
            str(git_source.get("sha") or "").lower(),
        }
        if state == "READY" and vercel_response_is_preview(deployment) and head_sha.lower() in shas:
            return _https_url(deployment.get("url"))
    return None


def vercel_response_is_preview(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    target = payload.get("target")
    return target is None or str(target).strip().lower() in {"", "preview"}


def github_deployment_is_safe_preview(deployment: Any) -> bool:
    if not isinstance(deployment, dict):
        return False
    if deployment.get("production_environment") is True:
        return False
    environment = str(deployment.get("environment") or "").strip().lower()
    transient = deployment.get("transient_environment") is True
    named_preview = any(marker in environment for marker in ("preview", "review", "pr-", "pull-request"))
    return deployment.get("production_environment") is False and (transient or named_preview)


def github_preview_deployment_body(head_sha: str, pr_number: int) -> dict[str, Any]:
    if not SHA_RE.fullmatch(str(head_sha or "")):
        raise ValueError("head_sha must be a 40-character Git SHA")
    if int(pr_number) <= 0:
        raise ValueError("pr_number must be positive")
    return {
        "ref": head_sha,
        "environment": f"vibeus-preview/pr-{int(pr_number)}",
        "description": f"VibeUs safe preview request for PR #{int(pr_number)}",
        "auto_merge": False,
        "required_contexts": [],
        "transient_environment": True,
        "production_environment": False,
        "payload": {"vibeus_preview": True, "pr_number": int(pr_number), "head_sha": head_sha},
    }


def vercel_preview_request_body(
    project_data: Any,
    *,
    github_repo_id: int,
    branch_name: str,
    head_sha: str,
    provider_project_id: str,
    pr_number: int,
) -> dict[str, Any]:
    if not isinstance(project_data, dict):
        raise ValueError("Vercel project metadata is missing")
    link = project_data.get("link") if isinstance(project_data.get("link"), dict) else {}
    if str(link.get("type") or "").lower() != "github":
        raise ValueError("Vercel project must be linked to GitHub")
    repo_id = int(link.get("repoId") or 0)
    if repo_id <= 0 or repo_id != int(github_repo_id):
        raise ValueError("Vercel project is linked to a different GitHub repository")
    production_branch = str(link.get("productionBranch") or project_data.get("productionBranch") or "").strip()
    if not production_branch:
        raise ValueError("Vercel production branch could not be verified")
    if branch_name.strip().lower() == production_branch.lower():
        raise ValueError("Vercel preview request refused for the production branch")
    if not SHA_RE.fullmatch(str(head_sha or "")):
        raise ValueError("head_sha must be a 40-character Git SHA")
    name = str(project_data.get("name") or provider_project_id).strip()
    return {
        "name": name,
        "project": provider_project_id,
        "gitSource": {
            "type": "github",
            "ref": branch_name,
            "repoId": repo_id,
            "sha": head_sha,
        },
        "meta": {
            "vibeusPreview": "true",
            "vibeusPullRequest": str(int(pr_number)),
            "vibeusHeadSha": head_sha,
        },
    }


async def _github_request(
    project: models.Project,
    method: str,
    path: str,
    *,
    params: Optional[dict[str, Any]] = None,
    json_body: Optional[dict[str, Any]] = None,
    allowed: tuple[int, ...] = (),
) -> Any:
    repo = github_app_auth._safe_repo(project.github_repo)
    legacy_pat = project.github_token if getattr(project, "github_token_encrypted", None) else None
    try:
        _kind, token = await github_app_auth.resolve_credential(repo, legacy_pat)
    except github_app_auth.GitHubAppError as exc:
        raise HTTPException(status_code=getattr(exc, "status_code", 502), detail=str(exc)) from exc
    if not token:
        raise HTTPException(status_code=409, detail="GitHub is not connected for this project")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.request(
                method,
                f"{github_app_auth.GITHUB_API_BASE}/repos/{repo}{path}",
                headers=github_app_auth._headers(token),
                params=params,
                json=json_body,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="GitHub preview request failed") from exc
    if response.status_code in allowed:
        return None
    if response.status_code < 200 or response.status_code >= 300:
        detail = "GitHub preview request was rejected"
        try:
            payload = response.json()
            if isinstance(payload, dict) and payload.get("message"):
                detail = f"GitHub: {payload['message']}"
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=detail)
    if response.status_code == 204 or not response.content:
        return None
    return response.json()


async def _github_preview_url(project: models.Project, head_sha: str) -> Optional[str]:
    deployments = await _github_request(project, "GET", "/deployments", params={"sha": head_sha, "per_page": 20})
    for deployment in deployments or []:
        if not github_deployment_is_safe_preview(deployment):
            continue
        statuses = await _github_request(
            project,
            "GET",
            f"/deployments/{deployment['id']}/statuses",
            params={"per_page": 20},
        )
        for status in statuses or []:
            if str(status.get("state") or "").lower() == "success":
                url = status.get("environment_url") or status.get("target_url")
                if isinstance(url, str) and url.startswith(("https://", "http://")):
                    return url[:2048]
    return None


async def _vercel_request(
    config: ProjectPreviewConfig,
    method: str,
    path: str,
    *,
    params: Optional[dict[str, Any]] = None,
    json_body: Optional[dict[str, Any]] = None,
    allowed: tuple[int, ...] = (),
) -> Any:
    token = config.api_token
    if not token:
        raise HTTPException(status_code=409, detail="Vercel API token is required")
    query = dict(params or {})
    if config.provider_scope_id:
        query["teamId"] = config.provider_scope_id
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.request(
                method,
                f"{VERCEL_API_BASE}{path}",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                params=query,
                json=json_body,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Vercel API request failed") from exc
    if response.status_code in allowed:
        return None
    if response.status_code < 200 or response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"Vercel API rejected the request ({response.status_code})")
    if response.status_code == 204 or not response.content:
        return None
    return response.json()


async def _vercel_project(config: ProjectPreviewConfig) -> Any:
    if not config.provider_project_id:
        raise HTTPException(status_code=409, detail="Vercel project ID is required")
    return await _vercel_request(config, "GET", f"/v9/projects/{quote(config.provider_project_id, safe='')}")


async def _vercel_deployments(config: ProjectPreviewConfig, *, limit: int = 20) -> Any:
    if not config.provider_project_id:
        raise HTTPException(status_code=409, detail="Vercel project ID is required")
    return await _vercel_request(
        config,
        "GET",
        "/v6/deployments",
        params={"projectId": config.provider_project_id, "limit": limit},
    )


async def _live_pr_context(project: models.Project, state: TicketAutomationState) -> tuple[dict[str, Any], str, str]:
    if not state.github_pr_number:
        raise HTTPException(status_code=409, detail="A linked pull request is required before requesting a preview")
    pr = await _github_request(project, "GET", f"/pulls/{int(state.github_pr_number)}")
    repo = github_app_auth._safe_repo(project.github_repo).lower()
    base = pr.get("base") if isinstance(pr.get("base"), dict) else {}
    head = pr.get("head") if isinstance(pr.get("head"), dict) else {}
    base_repo = str(((base.get("repo") or {}).get("full_name") or "")).lower()
    head_repo = str(((head.get("repo") or {}).get("full_name") or "")).lower()
    head_sha = str(head.get("sha") or "").lower()
    head_ref = str(head.get("ref") or "").strip()
    base_ref = str(base.get("ref") or "").strip()
    if pr.get("state") != "open" or pr.get("merged_at"):
        raise HTTPException(status_code=409, detail="Preview requests require an open, unmerged pull request")
    if base_repo != repo or head_repo != repo:
        raise HTTPException(status_code=409, detail="Preview requests are limited to pull requests inside the connected repository")
    if not SHA_RE.fullmatch(head_sha):
        raise HTTPException(status_code=502, detail="Pull request head SHA is invalid")
    if state.head_sha and state.head_sha.lower() != head_sha:
        raise HTTPException(status_code=409, detail="Pull request head changed; reconcile before requesting a preview")
    if state.branch_name and state.branch_name != head_ref:
        raise HTTPException(status_code=409, detail="Pull request branch changed; reconcile before requesting a preview")
    if not head_ref or head_ref == base_ref:
        raise HTTPException(status_code=409, detail="Preview request refused for the pull request base branch")
    repo_data = await _github_request(project, "GET", "")
    default_branch = str((repo_data or {}).get("default_branch") or "").strip()
    if not default_branch or head_ref == default_branch:
        raise HTTPException(status_code=409, detail="Preview request refused for the default branch")
    return pr, head_sha, head_ref


async def _live_ci_green(project: models.Project, head_sha: str) -> bool:
    checks = await _github_request(project, "GET", f"/commits/{head_sha}/check-runs")
    combined = await _github_request(project, "GET", f"/commits/{head_sha}/status")
    runs = list((checks or {}).get("check_runs") or [])
    combined_total = int((combined or {}).get("total_count") or 0)
    combined_state = str((combined or {}).get("state") or "pending").lower()
    failed_conclusions = {"failure", "cancelled", "timed_out", "action_required", "stale", "startup_failure"}
    if any(run.get("status") != "completed" for run in runs):
        return False
    if any(str(run.get("conclusion") or "").lower() in failed_conclusions for run in runs):
        return False
    if combined_total > 0 and combined_state != "success":
        return False
    return bool(runs) or (combined_total > 0 and combined_state == "success")


async def _existing_preview(config: ProjectPreviewConfig, project: models.Project, head_sha: str) -> Optional[str]:
    if config.provider in {"github", "render"}:
        return await _github_preview_url(project, head_sha)
    if config.provider == "vercel":
        return vercel_preview_url(await _vercel_deployments(config), head_sha)
    return None


async def _request_github_preview(project: models.Project, state: TicketAutomationState, head_sha: str) -> dict[str, Any]:
    body = github_preview_deployment_body(head_sha, int(state.github_pr_number or 0))
    deployment = await _github_request(project, "POST", "/deployments", json_body=body)
    return {
        "provider": "github",
        "mechanism": "transient_github_deployment",
        "request_id": str((deployment or {}).get("id") or ""),
        "request_url": str((deployment or {}).get("url") or "") or None,
    }


async def _request_vercel_preview(
    config: ProjectPreviewConfig,
    project: models.Project,
    state: TicketAutomationState,
    head_sha: str,
    branch_name: str,
) -> dict[str, Any]:
    project_data = await _vercel_project(config)
    github_repo = await _github_request(project, "GET", "")
    github_repo_id = int((github_repo or {}).get("id") or 0)
    try:
        body = vercel_preview_request_body(
            project_data,
            github_repo_id=github_repo_id,
            branch_name=branch_name,
            head_sha=head_sha,
            provider_project_id=str(config.provider_project_id or ""),
            pr_number=int(state.github_pr_number or 0),
        )
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    deployment = await _vercel_request(config, "POST", "/v13/deployments", params={"forceNew": "1"}, json_body=body)
    if not vercel_response_is_preview(deployment):
        deployment_id = str((deployment or {}).get("id") or "")
        if deployment_id:
            try:
                await _vercel_request(config, "PATCH", f"/v12/deployments/{quote(deployment_id, safe='')}/cancel")
            except HTTPException:
                logger.error("Failed to cancel unexpected non-preview Vercel deployment %s", deployment_id, exc_info=True)
        raise HTTPException(status_code=409, detail="Vercel returned a non-preview target; deployment was refused")
    return {
        "provider": "vercel",
        "mechanism": "vercel_git_preview",
        "request_id": str((deployment or {}).get("id") or ""),
        "request_url": _https_url((deployment or {}).get("url")),
    }


async def _request_render_preview(project: models.Project, state: TicketAutomationState) -> dict[str, Any]:
    label = "render-preview"
    existing = await _github_request(project, "GET", f"/labels/{quote(label, safe='')}", allowed=(404,))
    if existing is None:
        await _github_request(
            project,
            "POST",
            "/labels",
            json_body={"name": label, "color": "0f766e", "description": "Request a Render pull request preview"},
        )
    await _github_request(
        project,
        "POST",
        f"/issues/{int(state.github_pr_number or 0)}/labels",
        json_body={"labels": [label]},
    )
    return {
        "provider": "render",
        "mechanism": "render_preview_pr_label",
        "request_id": f"pr-{int(state.github_pr_number or 0)}:{label}",
        "request_url": None,
    }


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
            return await github_fallback()
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
        details={"provider": config.provider, "safe_preview_request_supported": config.provider != "disabled"},
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
    if provider == "disabled":
        return {"ok": True, "provider": "disabled", "safe_preview_request_supported": False}
    if not project.github_repo:
        raise HTTPException(status_code=409, detail="Connect GitHub before configuring previews")
    await _github_request(project, "GET", "")
    if provider == "github":
        return {"ok": True, "provider": "github", "safe_preview_request_supported": True}
    assert config is not None
    if provider == "vercel":
        await _vercel_project(config)
        return {"ok": True, "provider": "vercel", "safe_preview_request_supported": True}
    if provider == "render":
        return {"ok": True, "provider": "render", "mechanism": "render-preview label", "safe_preview_request_supported": True}
    raise HTTPException(status_code=422, detail="Unsupported preview provider")


@router.post("/api/projects/{slug}/tickets/{ticket_id}/automation/preview/deploy")
async def request_safe_preview_deploy(
    slug: str,
    ticket_id: str,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    if not project.github_repo:
        raise HTTPException(status_code=409, detail="Connect GitHub before requesting a preview")
    ticket_result = await db.execute(
        select(models.SpecTicket)
        .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
        .where(
            models.SpecTicket.id == ticket_id,
            models.SpecNode.project_id == project.id,
            models.SpecTicket.is_deleted.is_(False),
        )
    )
    ticket = ticket_result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    state = await db.get(TicketAutomationState, ticket.id)
    if not state:
        raise HTTPException(status_code=409, detail="AI orchestration state is required before requesting a preview")
    config = await _get_config(db, project.id)
    if not config:
        config = ProjectPreviewConfig(project_id=project.id, provider="github")
    if config.provider == "disabled":
        raise HTTPException(status_code=409, detail="Preview delivery is disabled for this project")

    _pr, head_sha, branch_name = await _live_pr_context(project, state)
    if state.ci_state != "success" or not await _live_ci_green(project, head_sha):
        raise HTTPException(status_code=409, detail="Safe preview requires green CI for the exact current pull request head")

    existing = await _existing_preview(config, project, head_sha)
    if existing:
        state.preview_url = existing
        await db.commit()
        return {
            "ok": True,
            "requested": False,
            "existing": True,
            "provider": config.provider,
            "preview_url": existing,
            "head_sha": head_sha,
            "production_deploy_allowed": False,
        }

    if config.provider == "github":
        result = await _request_github_preview(project, state, head_sha)
    elif config.provider == "vercel":
        result = await _request_vercel_preview(config, project, state, head_sha, branch_name)
    elif config.provider == "render":
        result = await _request_render_preview(project, state)
    else:
        raise HTTPException(status_code=422, detail="Unsupported preview provider")

    summary = dict(state.last_check_summary or {})
    summary["preview_request"] = {
        "provider": result["provider"],
        "mechanism": result["mechanism"],
        "request_id": result.get("request_id"),
        "head_sha": head_sha,
        "pr_number": int(state.github_pr_number or 0),
        "production_deploy_allowed": False,
        "requested_at": models.utcnow().isoformat(),
    }
    state.last_check_summary = summary
    db.add(models.AuditEvent(
        workspace_id=project.workspace_id,
        project_id=project.id,
        event_type="automation.preview_requested",
        details={
            "ticket_id": ticket.id,
            "pr_number": state.github_pr_number,
            "head_sha": head_sha,
            "provider": result["provider"],
            "mechanism": result["mechanism"],
            "production_deploy_allowed": False,
        },
    ))
    await db.commit()
    return {
        "ok": True,
        "requested": True,
        "existing": False,
        "head_sha": head_sha,
        "production_deploy_allowed": False,
        **result,
    }
