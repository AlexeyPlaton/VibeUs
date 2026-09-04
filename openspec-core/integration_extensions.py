from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import github_app_auth
import models
from database import get_db
from github_app_integration import router as github_app_router
from preview_adapters import router as preview_router

_INSTALLED = False


def _replace_route_call(router: Any, path: str, method: str, replacement: Any) -> None:
    target = method.upper()
    for route in router.routes:
        if getattr(route, "path", None) == path and target in (getattr(route, "methods", None) or set()):
            route.endpoint = replacement
            route.dependant.call = replacement
            return
    raise RuntimeError(f"Route not found: {target} {path}")


def _has_route(router: Any, path: str, method: str) -> bool:
    target = method.upper()
    return any(
        getattr(route, "path", None) == path
        and target in (getattr(route, "methods", None) or set())
        for route in router.routes
    )


async def _credential_for_project(project: Any, repo: str | None = None, legacy_override: str | None = None) -> tuple[str, str]:
    repository = github_app_auth._safe_repo(repo or getattr(project, "github_repo", None))
    legacy_pat = legacy_override
    if legacy_pat is None and getattr(project, "github_token_encrypted", None):
        legacy_pat = project.github_token
    try:
        credential_type, token = await github_app_auth.resolve_credential(repository, legacy_pat)
    except github_app_auth.GitHubAppError as exc:
        raise HTTPException(status_code=getattr(exc, "status_code", 502), detail=f"GitHub authentication failed: {exc}") from exc
    if not token or not credential_type:
        raise HTTPException(status_code=409, detail="Install the VibeUs GitHub App for this repository or configure a legacy PAT")
    return credential_type, token


def install_integration_extensions(module: Any) -> None:
    global _INSTALLED
    if _INSTALLED:
        return

    original_gh = module._gh
    original_get_config_endpoint = module.get_automation_config
    original_overview_endpoint = module.automation_overview

    async def gh(
        project: Any,
        method: str,
        path: str,
        *,
        params: Any = None,
        json_body: Any = None,
        allowed: tuple[int, ...] = (),
    ) -> Any:
        repo = module._safe_repo(getattr(project, "github_repo", None))
        credential_type, token = await _credential_for_project(project, repo)
        proxy = SimpleNamespace(github_repo=repo, github_token=token, credential_type=credential_type)
        return await original_gh(proxy, method, path, params=params, json_body=json_body, allowed=allowed)

    async def integration_status(project: Any) -> dict[str, Any]:
        if not getattr(project, "github_repo", None):
            return {
                **github_app_auth.app_configuration(),
                "app_installed": False,
                "has_pat": bool(getattr(project, "github_token_encrypted", None)),
                "credential_type": "pat" if getattr(project, "github_token_encrypted", None) else None,
            }
        legacy_pat = project.github_token if getattr(project, "github_token_encrypted", None) else None
        return await github_app_auth.credential_status(project.github_repo, legacy_pat)

    async def get_automation_config(
        slug: str,
        request: Request,
        project: models.Project = Depends(module._account_project),
        db: AsyncSession = Depends(get_db),
    ):
        payload = await original_get_config_endpoint(slug=slug, request=request, project=project, db=db)
        status = await integration_status(project)
        payload["github_connected"] = bool(project.github_repo and status.get("credential_type"))
        payload["github_credential_type"] = status.get("credential_type")
        payload["github_app_configured"] = bool(status.get("configured"))
        payload["github_app_installed"] = bool(status.get("app_installed"))
        return payload

    async def automation_overview(
        slug: str,
        request: Request,
        project: models.Project = Depends(module._account_project),
        db: AsyncSession = Depends(get_db),
    ):
        payload = await original_overview_endpoint(slug=slug, request=request, project=project, db=db)
        status = await integration_status(project)
        payload["project"]["github_connected"] = bool(project.github_repo and status.get("credential_type"))
        payload["project"]["github_credential_type"] = status.get("credential_type")
        payload["project"]["github_app_configured"] = bool(status.get("configured"))
        payload["project"]["github_app_installed"] = bool(status.get("app_installed"))
        return payload

    async def create_handoff(
        slug: str,
        ticket_id: str,
        data: Any,
        project: models.Project = Depends(module._account_project),
        db: AsyncSession = Depends(get_db),
    ):
        if not project.github_repo:
            raise HTTPException(status_code=409, detail="Connect GitHub before creating an AI handoff")
        ticket, node = await module._ticket(db, project, ticket_id)
        config = await module._get_or_create_config(db, project)
        provider = data.provider or config.agent_kind or "web_ai"
        base_branch, base_sha = await module._repo_head(project)
        state = await module._get_or_create_state(db, project, ticket, provider)
        state.provider = provider
        state.base_branch = base_branch
        state.base_sha = base_sha
        state.orchestration_status = "handoff_ready"
        issue_number = ticket.github_issue_number
        issue_url = ticket.github_issue_url
        if config.auto_issue_sync or provider in {"jules", "github_label_agent"}:
            issue_number, issue_url = await module._ensure_issue(project, ticket, node, base_branch, base_sha)
        should_dispatch = data.dispatch if data.dispatch is not None else bool(config.auto_dispatch_on_handoff)
        if should_dispatch and provider in {"jules", "github_label_agent"}:
            if not issue_number:
                issue_number, issue_url = await module._ensure_issue(project, ticket, node, base_branch, base_sha)
            label = "jules" if provider == "jules" else (config.dispatch_label or "")
            await module._dispatch_label(project, int(issue_number), label)
            state.orchestration_status = "agent_dispatched"
        db.add(models.AuditEvent(
            workspace_id=project.workspace_id,
            project_id=project.id,
            event_type="automation.ai_handoff_created",
            details={
                "ticket_id": ticket.id,
                "provider": provider,
                "base_sha": base_sha,
                "dispatched": should_dispatch,
                "github_credential": "github_app_or_legacy_pat",
            },
        ))
        await db.commit()
        return {
            "prompt": module._handoff_prompt(project, ticket, node, provider, base_branch, base_sha),
            "provider": provider,
            "base_branch": base_branch,
            "base_sha": base_sha,
            "github_issue_number": issue_number,
            "github_issue_url": issue_url,
            "state": module._state_payload(state),
        }

    module._gh = gh
    module.get_automation_config = get_automation_config
    module.automation_overview = automation_overview
    module.create_handoff = create_handoff
    _replace_route_call(module.router, "/api/projects/{slug}/automation", "GET", get_automation_config)
    _replace_route_call(module.router, "/api/projects/{slug}/automation/overview", "GET", automation_overview)
    _replace_route_call(module.router, "/api/projects/{slug}/tickets/{ticket_id}/ai/handoff", "POST", create_handoff)

    import main_legacy

    # The AI router can already have been included in the effective app before
    # this runtime hook executes. Register new independent surfaces directly on
    # that effective app so import order cannot silently drop them.
    if not _has_route(main_legacy.app.router, "/api/projects/{slug}/github/app", "GET"):
        main_legacy.app.include_router(github_app_router)
    if not _has_route(main_legacy.app.router, "/api/projects/{slug}/automation/preview", "GET"):
        main_legacy.app.include_router(preview_router)

    async def legacy_get_github_config(slug: str, project: Any):
        status = await integration_status(project)
        return {
            "github_repo": project.github_repo,
            "has_token": bool(status.get("credential_type")),
            "github_sync_enabled": bool(project.github_sync_enabled),
        }

    async def legacy_test_github_endpoint(slug: str, data: Any = None, project: Any = None):
        repo = (getattr(data, "github_repo", None) if data else None) or project.github_repo
        override = (getattr(data, "github_token", None) if data else None) or None
        if not repo:
            raise HTTPException(status_code=400, detail="GitHub repository is required")
        try:
            result = await github_app_auth.test_repository(repo, override if override is not None else (project.github_token if project.github_token_encrypted else None))
        except github_app_auth.GitHubAppError as exc:
            raise HTTPException(status_code=getattr(exc, "status_code", 502), detail=str(exc)) from exc
        return result

    async def legacy_sync_all(slug: str, request: Request, project: Any, db: AsyncSession):
        if not project.github_repo:
            raise HTTPException(status_code=400, detail="GitHub repository is not configured for this project")
        _kind, token = await _credential_for_project(project)
        proxy = SimpleNamespace(
            id=project.id,
            slug=project.slug,
            github_repo=project.github_repo,
            github_token=token,
        )
        res = await main_legacy.github_service.sync_project_tickets_to_github(
            db,
            proxy,
            base_url=str(request.base_url).rstrip("/"),
        )
        return {
            "status": "success" if res.get("ok") else "error",
            "synced_count": res.get("synced_count", 0),
            "issues": res.get("issues", []),
        }

    async def legacy_sync_single(slug: str, ticket_id: str, request: Request, project: Any, db: AsyncSession):
        if not project.github_repo:
            raise HTTPException(status_code=400, detail="GitHub repository is not configured for this project")
        _kind, token = await _credential_for_project(project)
        result = await db.execute(
            select(models.SpecTicket, models.SpecNode)
            .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
            .where(
                models.SpecTicket.id == ticket_id,
                models.SpecNode.project_id == project.id,
                models.SpecTicket.is_deleted.is_(False),
            )
        )
        row = result.first()
        if not row:
            raise HTTPException(status_code=404, detail="Ticket not found")
        ticket, node = row
        gh_res = await main_legacy.github_service.create_github_issue_for_ticket(
            repo=project.github_repo,
            token=token,
            ticket=ticket,
            project_slug=project.slug,
            node_title=node.title if node else "General",
            base_url=str(request.base_url).rstrip("/"),
        )
        if not gh_res.get("ok"):
            raise HTTPException(status_code=502, detail=gh_res.get("message") or "GitHub Issue creation failed")
        ticket.github_issue_url = gh_res.get("issue_url")
        ticket.github_issue_number = gh_res.get("issue_number")
        await db.commit()
        await db.refresh(ticket)
        return {
            "status": "success",
            "github_url": ticket.github_issue_url,
            "github_number": ticket.github_issue_number,
        }

    _replace_route_call(main_legacy.app.router, "/api/projects/{slug}/github", "GET", legacy_get_github_config)
    _replace_route_call(main_legacy.app.router, "/api/projects/{slug}/github/test", "POST", legacy_test_github_endpoint)
    _replace_route_call(main_legacy.app.router, "/api/projects/{slug}/github/sync", "POST", legacy_sync_all)
    _replace_route_call(main_legacy.app.router, "/api/projects/{slug}/tickets/{ticket_id}/github/sync", "POST", legacy_sync_single)

    _INSTALLED = True
