"""Runtime hardening for the provider-agnostic AI orchestration router.

The release wrapper owns final transport assembly, so this module installs the
small pieces of policy that depend on the effective hosted runtime rather than
on a specific AI provider. Keeping them separate also makes these policies easy
to regression-test without calling a real GitHub account.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import HTTPException, Request


_INSTALLED = False
logger = logging.getLogger("vibeus.ai_orchestration")


def _has_route(router: Any, path: str, method: str) -> bool:
    target = method.upper()
    return any(
        getattr(route, "path", None) == path
        and target in (getattr(route, "methods", None) or set())
        for route in router.routes
    )


def _register_independent_routes() -> None:
    """Register App/preview surfaces independently from the AI router lifecycle."""
    import main_legacy
    from github_app_integration import router as github_app_router
    from preview_adapters import router as preview_router

    if not _has_route(main_legacy.app.router, "/api/projects/{slug}/github/app", "GET"):
        main_legacy.app.include_router(github_app_router)
    if not _has_route(main_legacy.app.router, "/api/projects/{slug}/automation/preview", "GET"):
        main_legacy.app.include_router(preview_router)


_register_independent_routes()


def install_ai_orchestration_runtime(module: Any) -> None:
    """Install idempotent fail-closed runtime policy overrides."""
    global _INSTALLED
    if _INSTALLED:
        _register_independent_routes()
        return

    original_get_config = module._get_or_create_config
    original_config_payload = module._config_payload

    def dod(ticket: Any) -> list[str]:
        raw = getattr(ticket, "checklists", None) or {}
        result: list[str] = []

        def append_text(value: Any) -> None:
            text = str(value or "").strip()
            if text and text not in result:
                result.append(text[:2_000])

        if isinstance(raw, dict):
            legacy_items = raw.get("items")
            if isinstance(legacy_items, list):
                for item in legacy_items[:100]:
                    if isinstance(item, dict):
                        append_text(item.get("text") or item.get("title") or item.get("requirement") or item.get("label"))
                    else:
                        append_text(item)
            else:
                for key, item in list(raw.items())[:100]:
                    if isinstance(item, dict):
                        append_text(item.get("text") or item.get("title") or item.get("requirement") or key)
                    else:
                        append_text(key)
        elif isinstance(raw, list):
            for item in raw[:100]:
                if isinstance(item, dict):
                    append_text(item.get("text") or item.get("title") or item.get("requirement") or item.get("label"))
                else:
                    append_text(item)
        return result

    async def get_or_create_config(db: Any, project: Any) -> Any:
        config = await original_get_config(db, project)
        dispatch_capable = config.agent_kind in {"jules", "github_label_agent"}
        if config.autonomy_mode in {"autopilot_pr", "delivery"} and dispatch_capable:
            config.auto_dispatch_on_handoff = True
        if not dispatch_capable:
            config.auto_dispatch_on_handoff = False
        return config

    def config_payload(config: Any, request: Request) -> dict[str, Any]:
        payload = original_config_payload(config, request)
        slug = str(request.path_params.get("slug") or "").strip()
        if slug:
            payload["webhook_url"] = (
                f"{str(request.base_url).rstrip('/')}/api/projects/"
                f"{slug}/automation/github-webhook"
            )
        return payload

    async def github_deployment_preview(project: Any, head_sha: str) -> Optional[str]:
        from preview_adapters import github_deployment_is_safe_preview

        try:
            deployments = await module._gh(
                project,
                "GET",
                "/deployments",
                params={"sha": head_sha, "per_page": 10},
            )
            for deployment in deployments or []:
                if not github_deployment_is_safe_preview(deployment):
                    continue
                try:
                    statuses = await module._gh(
                        project,
                        "GET",
                        f"/deployments/{deployment['id']}/statuses",
                        params={"per_page": 10},
                    )
                except HTTPException:
                    continue
                for status in statuses or []:
                    if status.get("state") == "success":
                        url = status.get("environment_url") or status.get("target_url")
                        if isinstance(url, str) and url.startswith(("https://", "http://")):
                            return url[:2048]
        except HTTPException:
            return None
        return None

    async def preview_url(project: Any, head_sha: str) -> Optional[str]:
        from preview_adapters import discover_preview_for_project

        return await discover_preview_for_project(
            project,
            head_sha,
            lambda: github_deployment_preview(project, head_sha),
        )

    async def reconcile(db: Any, project: Any, ticket: Any, state: Any, config: Any) -> Any:
        if not state.github_pr_number:
            return state

        pr = await module._gh(project, "GET", f"/pulls/{state.github_pr_number}")
        head_sha = str((pr.get("head") or {}).get("sha") or "")
        state.head_sha = head_sha or state.head_sha
        state.github_pr_url = str(pr.get("html_url") or state.github_pr_url or "") or None
        state.branch_name = str((pr.get("head") or {}).get("ref") or state.branch_name or "") or None

        if pr.get("merged_at"):
            state.orchestration_status = "merged_waiting_human_acceptance"
            state.ci_state = "success"
            await db.commit()
            return state
        if pr.get("state") == "closed":
            state.orchestration_status = "pr_closed"
            await db.commit()
            return state
        if not config.observe_ci:
            state.ci_state = "not_observed"
            state.orchestration_status = "pr_open"
            await db.commit()
            return state

        checks = await module._gh(project, "GET", f"/commits/{head_sha}/check-runs")
        combined = await module._gh(project, "GET", f"/commits/{head_sha}/status")
        runs = list((checks or {}).get("check_runs") or [])
        combined_total = int((combined or {}).get("total_count") or 0)
        combined_state = str((combined or {}).get("state") or "pending").lower()
        failed_conclusions = {
            "failure",
            "cancelled",
            "timed_out",
            "action_required",
            "stale",
            "startup_failure",
        }

        pending = any(run.get("status") != "completed" for run in runs)
        failed = any(str(run.get("conclusion") or "").lower() in failed_conclusions for run in runs)
        if combined_total > 0:
            if combined_state in {"failure", "error"}:
                failed = True
            elif combined_state == "pending":
                pending = True

        has_ci_signal = bool(runs) or combined_total > 0
        success = has_ci_signal and not failed and not pending
        state.last_check_summary = {
            "total": len(runs),
            "failed": sum(1 for run in runs if str(run.get("conclusion") or "").lower() in failed_conclusions),
            "combined": combined_state if combined_total > 0 else "none",
            "combined_total": combined_total,
            "head_sha": head_sha,
        }

        if failed:
            state.ci_state = "failure"
            if state.last_failed_head_sha != head_sha:
                state.repair_attempts = int(state.repair_attempts or 0) + 1
                state.last_failed_head_sha = head_sha
            if state.repair_attempts > int(config.max_repair_attempts or 0):
                state.orchestration_status = "blocked_repair_budget"
            elif state.provider == "jules":
                state.orchestration_status = "native_repair_monitoring"
            else:
                state.orchestration_status = "repair_handoff_ready"
            await db.commit()
            return state

        if not success:
            state.ci_state = "pending"
            state.orchestration_status = "ci_running"
            await db.commit()
            return state

        state.ci_state = "success"
        if config.observe_preview:
            state.preview_url = await preview_url(project, head_sha)

        ready, missing = module.criteria_auto_review_ready(ticket)
        state.last_check_summary = {
            **dict(state.last_check_summary or {}),
            "vibeus_evidence_ready": ready,
            "missing_evidence": missing,
        }
        moved_to_review = False
        if ready and config.auto_move_to_review and ticket.status not in {"review", "done"}:
            ticket.status = "review"
            ticket.revision = int(ticket.revision or 0) + 1
            project.revision = int(project.revision or 0) + 1
            state.orchestration_status = "review_ready"
            moved_to_review = True
            db.add(
                module.models.AuditEvent(
                    workspace_id=project.workspace_id,
                    project_id=project.id,
                    event_type="automation.review_ready",
                    details={
                        "ticket_id": ticket.id,
                        "pr_number": state.github_pr_number,
                        "human_acceptance_required": True,
                    },
                )
            )
        elif ready and state.preview_url:
            state.orchestration_status = "preview_ready_for_human_review"
        elif ready:
            state.orchestration_status = "review_gate_ready"
        else:
            state.orchestration_status = "ci_green_evidence_pending"
        await db.commit()

        if moved_to_review:
            try:
                import main_legacy

                await main_legacy.manager.broadcast(
                    {"type": "board.refresh", "revision": project.revision},
                    project.id,
                )
            except Exception:
                logger.warning(
                    "Unable to broadcast AI orchestration Review transition for project %s",
                    getattr(project, "id", "unknown"),
                    exc_info=True,
                )
        return state

    module._dod = dod
    module._get_or_create_config = get_or_create_config
    module._config_payload = config_payload
    module._preview_url = preview_url
    module._reconcile = reconcile

    from integration_extensions import install_integration_extensions

    install_integration_extensions(module)
    _INSTALLED = True
