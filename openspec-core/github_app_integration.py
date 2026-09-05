from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import auth
import github_app_auth
import models
from database import get_db

router = APIRouter(tags=["github-app"])


class GitHubAppConnectRequest(BaseModel):
    github_repo: str = Field(..., min_length=3, max_length=255)


class GitHubAppInstallIntentRequest(BaseModel):
    github_repo: str = Field(..., min_length=3, max_length=255)


class GitHubAppInstallCompleteRequest(BaseModel):
    state: str = Field(..., min_length=20, max_length=4096)


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


async def _account_project_by_id(
    project_id: str,
    user: models.User,
    db: AsyncSession,
) -> models.Project:
    result = await db.execute(
        select(models.Project, models.WorkspaceMembership)
        .join(models.WorkspaceMembership, models.WorkspaceMembership.workspace_id == models.Project.workspace_id)
        .where(
            models.Project.id == project_id,
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


def _legacy_pat(project: models.Project) -> Optional[str]:
    return project.github_token if project.github_token_encrypted else None


def _http_error(exc: github_app_auth.GitHubAppError) -> HTTPException:
    status = getattr(exc, "status_code", 502)
    if isinstance(exc, github_app_auth.GitHubAppConfigurationError):
        status = 503
    return HTTPException(status_code=status, detail=str(exc))


async def _verify_app_repository(repo: str) -> tuple[int, dict[str, Any]]:
    try:
        installation_id = await github_app_auth.resolve_installation_id(repo)
        if not installation_id:
            raise HTTPException(status_code=409, detail="Install the VibeUs GitHub App for this repository first")
        test = await github_app_auth.test_repository(repo, None)
    except HTTPException:
        raise
    except github_app_auth.GitHubAppError as exc:
        raise _http_error(exc) from exc
    if not test.get("ok") or test.get("credential_type") != "github_app":
        raise HTTPException(status_code=409, detail="GitHub App installation could not be verified for this repository")
    return int(installation_id), test


@router.get("/api/projects/{slug}/github/app")
async def github_app_status(
    slug: str,
    project: models.Project = Depends(_account_project),
):
    status = await github_app_auth.credential_status(project.github_repo, _legacy_pat(project))
    return {
        **status,
        "github_repo": project.github_repo,
        "github_sync_enabled": bool(project.github_sync_enabled),
    }


@router.post("/api/projects/{slug}/github/app/install-intent")
async def create_github_app_install_intent(
    slug: str,
    data: GitHubAppInstallIntentRequest,
    user: models.User = Depends(auth.get_current_user),
    project: models.Project = Depends(_account_project),
):
    config = github_app_auth.app_configuration()
    if not config["configured"]:
        raise HTTPException(status_code=503, detail="GitHub App is not fully configured on this VibeUs deployment")
    if not config.get("state_ready"):
        raise HTTPException(status_code=503, detail="GitHub App onboarding state signing is not configured")
    try:
        repo = github_app_auth._safe_repo(data.github_repo)
        state = github_app_auth.build_install_state(
            project_id=str(project.id),
            user_id=str(user.id),
            repo=repo,
        )
        install_url = github_app_auth.install_url_for_state(state)
    except github_app_auth.GitHubAppError as exc:
        raise _http_error(exc) from exc
    return {
        "install_url": install_url,
        "setup_url": config.get("setup_url"),
        "expires_in": 900,
        "github_repo": repo,
    }


@router.post("/api/github/app/install/complete")
async def complete_github_app_install(
    data: GitHubAppInstallCompleteRequest,
    user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        payload = github_app_auth.parse_install_state(data.state)
    except github_app_auth.GitHubAppError as exc:
        raise _http_error(exc) from exc
    if str(payload.get("uid")) != str(user.id):
        raise HTTPException(status_code=403, detail="GitHub App install state belongs to another account")
    project = await _account_project_by_id(str(payload["pid"]), user, db)
    repo = github_app_auth._safe_repo(str(payload["repo"]))
    installation_id, _test = await _verify_app_repository(repo)

    project.github_repo = repo
    project.github_sync_enabled = True
    db.add(models.AuditEvent(
        workspace_id=project.workspace_id,
        project_id=project.id,
        user_id=user.id,
        event_type="github.app_install_completed",
        details={
            "repository": repo,
            "installation_id": installation_id,
            "credential_type": "github_app",
            "state_bound": True,
            "browser_installation_id_ignored": True,
        },
    ))
    await db.commit()
    status = await github_app_auth.credential_status(project.github_repo, _legacy_pat(project))
    return {
        **status,
        "github_repo": project.github_repo,
        "github_sync_enabled": True,
        "project_slug": project.slug,
    }


@router.post("/api/projects/{slug}/github/app/connect")
async def connect_github_app(
    slug: str,
    data: GitHubAppConnectRequest,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    config = github_app_auth.app_configuration()
    if not config["configured"]:
        raise HTTPException(status_code=503, detail="GitHub App is not fully configured on this VibeUs deployment")
    try:
        repo = github_app_auth._safe_repo(data.github_repo)
    except github_app_auth.GitHubAppError as exc:
        raise _http_error(exc) from exc
    installation_id, _test = await _verify_app_repository(repo)
    project.github_repo = repo
    project.github_sync_enabled = True
    db.add(models.AuditEvent(
        workspace_id=project.workspace_id,
        project_id=project.id,
        event_type="github.app_connected",
        details={"repository": repo, "installation_id": installation_id, "credential_type": "github_app"},
    ))
    await db.commit()
    status = await github_app_auth.credential_status(project.github_repo, _legacy_pat(project))
    return {**status, "github_repo": project.github_repo, "github_sync_enabled": True}


@router.post("/api/projects/{slug}/github/app/test")
async def test_github_app(
    slug: str,
    project: models.Project = Depends(_account_project),
):
    if not project.github_repo:
        raise HTTPException(status_code=409, detail="Configure a GitHub repository first")
    try:
        return await github_app_auth.test_repository(project.github_repo, _legacy_pat(project))
    except github_app_auth.GitHubAppError as exc:
        raise _http_error(exc) from exc


@router.delete("/api/projects/{slug}/github/pat")
async def remove_legacy_pat(
    slug: str,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    if not project.github_repo:
        raise HTTPException(status_code=409, detail="Configure a GitHub repository first")
    try:
        installation_id = await github_app_auth.resolve_installation_id(project.github_repo)
        if not installation_id or not await github_app_auth.installation_token(project.github_repo):
            raise HTTPException(status_code=409, detail="Verify the GitHub App installation before removing the legacy PAT")
    except HTTPException:
        raise
    except github_app_auth.GitHubAppError as exc:
        raise _http_error(exc) from exc
    had_pat = bool(project.github_token_encrypted)
    project.github_token_encrypted = None
    db.add(models.AuditEvent(
        workspace_id=project.workspace_id,
        project_id=project.id,
        event_type="github.legacy_pat_removed",
        details={"repository": project.github_repo, "had_pat": had_pat, "github_app_verified": True},
    ))
    await db.commit()
    return {"ok": True, "had_pat": had_pat, "credential_type": "github_app"}
