from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timezone
from typing import Any, Literal, Optional
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import auth
import models
from ai_orchestration_models import DEFAULT_PROTECTED_PATHS, ProjectAutomationConfig, TicketAutomationState
from ai_patch import apply_file_patch, extract_patch_envelope, parse_unified_diff, path_is_protected, sanitize_context
from criteria_evidence import criteria_auto_review_ready
from database import get_db

router = APIRouter(tags=["ai-orchestration"])
GITHUB_API_BASE = "https://api.github.com"
MAX_FILE_BYTES = 1_500_000
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$", re.IGNORECASE)


class AutomationConfigUpdate(BaseModel):
    autonomy_mode: Literal["manual", "assisted", "autopilot_pr", "delivery"] = "assisted"
    agent_kind: Literal["web_ai", "jules", "github_label_agent", "external_agent"] = "web_ai"
    dispatch_label: str = Field(default="", max_length=64)
    auto_issue_sync: bool = True
    auto_dispatch_on_handoff: bool = False
    create_pr_from_patch: bool = True
    observe_ci: bool = True
    observe_preview: bool = True
    auto_move_to_review: bool = True
    max_repair_attempts: int = Field(default=2, ge=0, le=5)
    merge_policy: Literal["manual", "human_accept"] = "human_accept"
    protected_paths: list[str] = Field(default_factory=lambda: list(DEFAULT_PROTECTED_PATHS), max_length=50)

    @field_validator("dispatch_label")
    @classmethod
    def validate_label(cls, value: str) -> str:
        value = value.strip()
        if any(ch in value for ch in "\r\n\t"):
            raise ValueError("dispatch_label must be a single line")
        return value

    @field_validator("protected_paths")
    @classmethod
    def validate_paths(cls, value: list[str]) -> list[str]:
        result: list[str] = []
        for raw in value:
            item = str(raw).strip().replace("\\", "/")
            if not item or item.startswith("/") or ".." in item.split("/") or len(item) > 240:
                raise ValueError("protected_paths contains an invalid path")
            if item not in result:
                result.append(item)
        return result


class HandoffRequest(BaseModel):
    provider: Optional[Literal["web_ai", "jules", "github_label_agent", "external_agent"]] = None
    dispatch: Optional[bool] = None


class ApplyPatchRequest(BaseModel):
    ai_answer: str = Field(..., min_length=1, max_length=400_000)
    base_sha: Optional[str] = Field(default=None, max_length=64)


class LinkPullRequestRequest(BaseModel):
    pr_number: int = Field(..., ge=1, le=2_000_000_000)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _safe_repo(repo: Optional[str]) -> str:
    value = (repo or "").strip().strip("/")
    if not REPO_RE.fullmatch(value):
        raise HTTPException(status_code=400, detail="GitHub repository must use owner/repo format")
    return value


def _github_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token.strip()}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "VibeUs-Orchestrator/1.0",
    }


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


async def _gh(
    project: models.Project,
    method: str,
    path: str,
    *,
    params: Optional[dict[str, Any]] = None,
    json_body: Optional[dict[str, Any]] = None,
    allowed: tuple[int, ...] = (),
) -> Any:
    repo = _safe_repo(project.github_repo)
    token = project.github_token
    if not token:
        raise HTTPException(status_code=409, detail="GitHub is not connected for this project")
    url = f"{GITHUB_API_BASE}/repos/{repo}{path}"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.request(
                method,
                url,
                headers=_github_headers(token),
                params=params,
                json=json_body,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="GitHub request failed") from exc
    if response.status_code in allowed:
        return None
    if response.status_code < 200 or response.status_code >= 300:
        detail = "GitHub API request failed"
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


async def _get_or_create_config(db: AsyncSession, project: models.Project) -> ProjectAutomationConfig:
    config = await db.get(ProjectAutomationConfig, project.id)
    if config:
        return config
    config = ProjectAutomationConfig(project_id=project.id, protected_paths=list(DEFAULT_PROTECTED_PATHS))
    db.add(config)
    await db.flush()
    return config


async def _get_or_create_state(
    db: AsyncSession,
    project: models.Project,
    ticket: models.SpecTicket,
    provider: str = "web_ai",
) -> TicketAutomationState:
    state = await db.get(TicketAutomationState, ticket.id)
    if state:
        return state
    state = TicketAutomationState(ticket_id=ticket.id, project_id=project.id, provider=provider)
    db.add(state)
    await db.flush()
    return state


async def _ticket(db: AsyncSession, project: models.Project, ticket_id: str) -> tuple[models.SpecTicket, models.SpecNode]:
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
    return row[0], row[1]


async def _repo_head(project: models.Project) -> tuple[str, str]:
    repo_data = await _gh(project, "GET", "")
    branch = str(repo_data.get("default_branch") or "main")
    ref = await _gh(project, "GET", f"/git/ref/heads/{quote(branch, safe='')}")
    sha = str(((ref or {}).get("object") or {}).get("sha") or "")
    if not SHA_RE.fullmatch(sha):
        raise HTTPException(status_code=502, detail="GitHub default branch HEAD could not be resolved")
    return branch, sha


def _dod(ticket: models.SpecTicket) -> list[str]:
    return [str(key) for key in (ticket.checklists or {}).keys() if str(key).strip()][:100]


def _handoff_prompt(
    project: models.Project,
    ticket: models.SpecTicket,
    node: models.SpecNode,
    provider: str,
    base_branch: str,
    base_sha: str,
) -> str:
    key = ticket.key or ticket.id
    context = sanitize_context(ticket.bug_context or {})
    summary = sanitize_context(ticket.summary or "")
    source_quote = sanitize_context(ticket.source_quote or "")
    dod = _dod(ticket)
    return "\n".join([
        "VibeUs AI Handoff v1",
        "",
        f"Ticket: {key}",
        f"Repository: {project.github_repo}",
        f"Base branch: {base_branch}",
        f"Base commit: {base_sha}",
        f"Execution surface: {provider}",
        f"Section: {node.title}",
        "",
        "Task:",
        str(summary),
        "",
        "Source/context:",
        str(source_quote),
        json.dumps(context, ensure_ascii=False, indent=2),
        "",
        "Definition of Done:",
        *[f"- {item}" for item in dod],
        "",
        "Rules:",
        "- Inspect the repository before changing code.",
        "- Keep changes inside the minimum necessary scope and add/update regression tests.",
        "- Never commit credentials, tokens, .env files, private keys, or generated secrets.",
        "- Never push directly to the default branch and never bypass repository protections.",
        "- If your environment can create a branch and pull request, reference this VibeUs ticket in the PR title or body.",
        "- If your environment is read-only, return the final answer using exactly the VIBEUS-PATCH v1 envelope below.",
        "- CI success is not VibeUs trusted criteria evidence. Final acceptance remains a human action.",
        "",
        "VIBEUS-PATCH v1",
        f"ticket: {key}",
        f"repository: {project.github_repo}",
        f"base_sha: {base_sha}",
        "---PATCH---",
        "<unified git diff beginning with: diff --git>",
        "---END PATCH---",
    ])


async def _ensure_issue(
    project: models.Project,
    ticket: models.SpecTicket,
    node: models.SpecNode,
    base_branch: str,
    base_sha: str,
) -> tuple[int, str]:
    if ticket.github_issue_number and ticket.github_issue_url:
        return int(ticket.github_issue_number), str(ticket.github_issue_url)
    key = ticket.key or ticket.id[:8]
    body = "\n".join([
        f"## VibeUs task `{key}`",
        "",
        ticket.summary or ticket.title,
        "",
        f"**Section:** {node.title}",
        f"**Priority:** {ticket.priority}",
        f"**Base:** `{base_branch}` @ `{base_sha}`",
        "",
        "### Definition of Done",
        *[f"- [ ] {item}" for item in _dod(ticket)],
        "",
        "### Agent contract",
        "Work on a separate branch/PR. Do not push to the default branch, expose secrets, or bypass human VibeUs acceptance.",
    ])
    issue = await _gh(project, "POST", "/issues", json_body={"title": f"[{key}] {ticket.title}", "body": body})
    ticket.github_issue_number = int(issue["number"])
    ticket.github_issue_url = str(issue["html_url"])
    return ticket.github_issue_number, ticket.github_issue_url


async def _ensure_label(project: models.Project, label: str) -> None:
    if not label:
        raise HTTPException(status_code=422, detail="A dispatch label is required for this agent")
    existing = await _gh(project, "GET", f"/labels/{quote(label, safe='')}", allowed=(404,))
    if existing is None:
        await _gh(
            project,
            "POST",
            "/labels",
            json_body={"name": label, "color": "6f42c1", "description": "VibeUs AI agent dispatch"},
        )


async def _dispatch_label(project: models.Project, issue_number: int, label: str) -> None:
    await _ensure_label(project, label)
    await _gh(project, "POST", f"/issues/{issue_number}/labels", json_body={"labels": [label]})


def _config_payload(config: ProjectAutomationConfig, request: Request) -> dict[str, Any]:
    return {
        "autonomy_mode": config.autonomy_mode,
        "agent_kind": config.agent_kind,
        "dispatch_label": config.dispatch_label or "",
        "auto_issue_sync": bool(config.auto_issue_sync),
        "auto_dispatch_on_handoff": bool(config.auto_dispatch_on_handoff),
        "create_pr_from_patch": bool(config.create_pr_from_patch),
        "observe_ci": bool(config.observe_ci),
        "observe_preview": bool(config.observe_preview),
        "auto_move_to_review": bool(config.auto_move_to_review),
        "max_repair_attempts": int(config.max_repair_attempts or 0),
        "merge_policy": config.merge_policy,
        "protected_paths": list(config.protected_paths or []),
        "has_webhook_secret": bool(config.github_webhook_secret_encrypted),
        "webhook_url": f"{str(request.base_url).rstrip('/')}/api/projects/{config.project_id}/automation/github-webhook",
    }


def _state_payload(state: Optional[TicketAutomationState]) -> Optional[dict[str, Any]]:
    if not state:
        return None
    return {
        "ticket_id": state.ticket_id,
        "provider": state.provider,
        "base_branch": state.base_branch,
        "base_sha": state.base_sha,
        "branch_name": state.branch_name,
        "github_pr_number": state.github_pr_number,
        "github_pr_url": state.github_pr_url,
        "head_sha": state.head_sha,
        "ci_state": state.ci_state,
        "preview_url": state.preview_url,
        "orchestration_status": state.orchestration_status,
        "repair_attempts": int(state.repair_attempts or 0),
        "last_check_summary": dict(state.last_check_summary or {}),
        "last_error": state.last_error,
    }


async def _read_repo_text(project: models.Project, path: str, ref: str) -> tuple[str, Optional[str]]:
    data = await _gh(project, "GET", f"/contents/{quote(path, safe='/')}", params={"ref": ref}, allowed=(404,))
    if data is None:
        return "", None
    if data.get("type") != "file" or data.get("encoding") != "base64":
        raise HTTPException(status_code=422, detail=f"Patch target is not a regular text file: {path}")
    raw = base64.b64decode(str(data.get("content") or ""), validate=False)
    if len(raw) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"Patch target is too large: {path}")
    try:
        return raw.decode("utf-8"), str(data.get("sha") or "") or None
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"Binary/non-UTF-8 patch target is not supported: {path}") from exc


async def _patch_to_pr(
    db: AsyncSession,
    project: models.Project,
    ticket: models.SpecTicket,
    state: TicketAutomationState,
    config: ProjectAutomationConfig,
    ai_answer: str,
    requested_base_sha: Optional[str],
) -> dict[str, Any]:
    if not config.create_pr_from_patch:
        raise HTTPException(status_code=409, detail="Patch-to-PR delivery is disabled for this project")
    metadata, diff = extract_patch_envelope(ai_answer)
    expected_ticket = ticket.key or ticket.id
    if metadata.get("ticket") not in {expected_ticket, ticket.id}:
        raise HTTPException(status_code=422, detail="VIBEUS-PATCH ticket does not match this task")
    repo = _safe_repo(project.github_repo)
    if metadata.get("repository", "").lower() != repo.lower():
        raise HTTPException(status_code=422, detail="VIBEUS-PATCH repository does not match the connected repository")
    base_sha = metadata["base_sha"].lower()
    if requested_base_sha and requested_base_sha.lower() != base_sha:
        raise HTTPException(status_code=422, detail="Requested base_sha does not match VIBEUS-PATCH")
    if state.base_sha and state.base_sha.lower() != base_sha:
        raise HTTPException(status_code=409, detail="VIBEUS-PATCH is not bound to the latest VibeUs handoff")

    patches = parse_unified_diff(diff)
    for patch in patches:
        if patch.old_path and patch.new_path and patch.old_path != patch.new_path:
            raise HTTPException(status_code=422, detail="File renames are not supported by guarded patch delivery")
        if path_is_protected(patch.target_path, list(config.protected_paths or [])):
            raise HTTPException(status_code=403, detail=f"PROTECTED_PATH_REQUIRES_MANUAL_WORKFLOW: {patch.target_path}")

    base_branch, current_sha = await _repo_head(project)
    if current_sha.lower() != base_sha:
        raise HTTPException(status_code=409, detail="STALE_BASE_SHA: regenerate the AI handoff against the current repository HEAD")
    commit_data = await _gh(project, "GET", f"/git/commits/{base_sha}")
    base_tree_sha = str((commit_data.get("tree") or {}).get("sha") or "")
    tree_data = await _gh(project, "GET", f"/git/trees/{base_tree_sha}", params={"recursive": "1"})
    mode_by_path = {
        str(item.get("path")): str(item.get("mode"))
        for item in (tree_data.get("tree") or [])
        if item.get("type") == "blob"
    }

    entries: list[dict[str, Any]] = []
    changed_files: list[str] = []
    for patch in patches:
        path = patch.target_path
        original, existing_sha = await _read_repo_text(project, patch.old_path or path, base_sha)
        if patch.old_path is not None and not existing_sha:
            raise HTTPException(status_code=409, detail=f"Base file no longer exists: {patch.old_path}")
        updated = apply_file_patch(original, patch)
        changed_files.append(path)
        if patch.new_path is None:
            if updated != "":
                raise HTTPException(status_code=422, detail=f"Deletion patch must remove the complete file: {path}")
            entries.append({"path": patch.old_path, "mode": mode_by_path.get(patch.old_path or "", "100644"), "type": "blob", "sha": None})
            continue
        encoded = base64.b64encode(updated.encode("utf-8")).decode("ascii")
        blob = await _gh(project, "POST", "/git/blobs", json_body={"content": encoded, "encoding": "base64"})
        mode = mode_by_path.get(patch.old_path or patch.new_path, "100644")
        if mode not in {"100644", "100755"}:
            mode = "100644"
        entries.append({"path": patch.new_path, "mode": mode, "type": "blob", "sha": blob["sha"]})

    new_tree = await _gh(project, "POST", "/git/trees", json_body={"base_tree": base_tree_sha, "tree": entries})
    key = ticket.key or ticket.id[:8]
    new_commit = await _gh(
        project,
        "POST",
        "/git/commits",
        json_body={
            "message": f"{key}: AI-assisted fix",
            "tree": new_tree["sha"],
            "parents": [base_sha],
        },
    )
    commit_sha = str(new_commit["sha"])
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", key).strip("-").lower()[:48] or "task"
    branch_name = f"vibeus/{slug}-{commit_sha[:7]}"
    await _gh(project, "POST", "/git/refs", json_body={"ref": f"refs/heads/{branch_name}", "sha": commit_sha})
    pr = await _gh(
        project,
        "POST",
        "/pulls",
        json_body={
            "title": f"[{key}] {ticket.title}",
            "head": branch_name,
            "base": base_branch,
            "body": "\n".join([
                f"VibeUs task: **{key}**",
                "",
                "Created through guarded VIBEUS-PATCH delivery.",
                f"Base commit: `{base_sha}`",
                "",
                "### Trust boundary",
                "- No direct write to the default branch.",
                "- Protected files are rejected by VibeUs before branch creation.",
                "- GitHub CI is delivery status, not fabricated VibeUs trusted criteria evidence.",
                "- Final task acceptance remains a human VibeUs Review action.",
            ]),
        },
    )
    state.provider = "web_ai"
    state.base_branch = base_branch
    state.base_sha = base_sha
    state.branch_name = branch_name
    state.head_sha = commit_sha
    state.github_pr_number = int(pr["number"])
    state.github_pr_url = str(pr["html_url"])
    state.ci_state = "pending"
    state.orchestration_status = "pr_created"
    state.last_error = None
    state.updated_at = _utcnow()
    db.add(models.AuditEvent(
        workspace_id=project.workspace_id,
        project_id=project.id,
        event_type="automation.ai_patch_pr_created",
        details={"ticket_id": ticket.id, "pr_number": state.github_pr_number, "changed_files": changed_files},
    ))
    await db.commit()
    return {"state": _state_payload(state), "changed_files": changed_files}


async def _preview_url(project: models.Project, head_sha: str) -> Optional[str]:
    deployments = await _gh(project, "GET", "/deployments", params={"sha": head_sha, "per_page": 10})
    for deployment in deployments or []:
        statuses = await _gh(project, "GET", f"/deployments/{deployment['id']}/statuses", params={"per_page": 10})
        for status in statuses or []:
            if status.get("state") == "success":
                url = status.get("environment_url") or status.get("target_url")
                if isinstance(url, str) and url.startswith(("https://", "http://")):
                    return url[:2048]
    return None


async def _reconcile(
    db: AsyncSession,
    project: models.Project,
    ticket: models.SpecTicket,
    state: TicketAutomationState,
    config: ProjectAutomationConfig,
) -> TicketAutomationState:
    if not state.github_pr_number:
        return state
    pr = await _gh(project, "GET", f"/pulls/{state.github_pr_number}")
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

    checks = await _gh(project, "GET", f"/commits/{head_sha}/check-runs")
    combined = await _gh(project, "GET", f"/commits/{head_sha}/status")
    runs = list((checks or {}).get("check_runs") or [])
    failed_conclusions = {"failure", "cancelled", "timed_out", "action_required", "stale", "startup_failure"}
    pending = any(run.get("status") != "completed" for run in runs)
    failed = any(str(run.get("conclusion") or "").lower() in failed_conclusions for run in runs)
    combined_state = str((combined or {}).get("state") or "pending").lower()
    if combined_state in {"failure", "error"}:
        failed = True
    elif combined_state == "pending":
        pending = True
    success = not failed and not pending and (bool(runs) or combined_state == "success")
    state.last_check_summary = {
        "total": len(runs),
        "failed": sum(1 for run in runs if str(run.get("conclusion") or "").lower() in failed_conclusions),
        "combined": combined_state,
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
        state.preview_url = await _preview_url(project, head_sha)
    ready, missing = criteria_auto_review_ready(ticket)
    state.last_check_summary = {**dict(state.last_check_summary or {}), "vibeus_evidence_ready": ready, "missing_evidence": missing}
    if ready and config.auto_move_to_review and ticket.status not in {"review", "done"}:
        ticket.status = "review"
        ticket.revision = int(ticket.revision or 0) + 1
        project.revision = int(project.revision or 0) + 1
        state.orchestration_status = "review_ready"
        db.add(models.AuditEvent(
            workspace_id=project.workspace_id,
            project_id=project.id,
            event_type="automation.review_ready",
            details={"ticket_id": ticket.id, "pr_number": state.github_pr_number, "human_acceptance_required": True},
        ))
    elif ready and state.preview_url:
        state.orchestration_status = "preview_ready_for_human_review"
    elif ready:
        state.orchestration_status = "review_gate_ready"
    else:
        state.orchestration_status = "ci_green_evidence_pending"
    await db.commit()
    return state


async def _bind_pr(
    db: AsyncSession,
    project: models.Project,
    ticket: models.SpecTicket,
    state: TicketAutomationState,
    pr_number: int,
) -> TicketAutomationState:
    pr = await _gh(project, "GET", f"/pulls/{pr_number}")
    repo = _safe_repo(project.github_repo).lower()
    base_repo = str((((pr.get("base") or {}).get("repo") or {}).get("full_name") or "")).lower()
    head_repo = str((((pr.get("head") or {}).get("repo") or {}).get("full_name") or "")).lower()
    if base_repo != repo or head_repo != repo:
        raise HTTPException(status_code=409, detail="Only pull requests whose base and head are in the connected repository can be managed")
    state.github_pr_number = int(pr["number"])
    state.github_pr_url = str(pr["html_url"])
    state.branch_name = str((pr.get("head") or {}).get("ref") or "") or None
    state.head_sha = str((pr.get("head") or {}).get("sha") or "") or None
    state.base_branch = str((pr.get("base") or {}).get("ref") or "") or None
    state.base_sha = str((pr.get("base") or {}).get("sha") or state.base_sha or "") or None
    state.orchestration_status = "pr_linked"
    db.add(models.AuditEvent(
        workspace_id=project.workspace_id,
        project_id=project.id,
        event_type="automation.pr_linked",
        details={"ticket_id": ticket.id, "pr_number": state.github_pr_number},
    ))
    await db.commit()
    return state


@router.get("/api/projects/{slug}/automation")
async def get_automation_config(
    slug: str,
    request: Request,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    config = await _get_or_create_config(db, project)
    await db.commit()
    return {**_config_payload(config, request), "github_repo": project.github_repo, "github_connected": bool(project.github_repo and project.github_token_encrypted)}


@router.put("/api/projects/{slug}/automation")
async def update_automation_config(
    slug: str,
    data: AutomationConfigUpdate,
    request: Request,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    config = await _get_or_create_config(db, project)
    for name, value in data.model_dump().items():
        setattr(config, name, value)
    if config.agent_kind == "jules" and not config.dispatch_label:
        config.dispatch_label = "jules"
    db.add(models.AuditEvent(
        workspace_id=project.workspace_id,
        project_id=project.id,
        event_type="automation.config_updated",
        details={"autonomy_mode": config.autonomy_mode, "agent_kind": config.agent_kind, "max_repair_attempts": config.max_repair_attempts},
    ))
    await db.commit()
    return _config_payload(config, request)


@router.get("/api/projects/{slug}/automation/overview")
async def automation_overview(
    slug: str,
    request: Request,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    config = await _get_or_create_config(db, project)
    result = await db.execute(
        select(models.SpecTicket, models.SpecNode, TicketAutomationState)
        .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
        .outerjoin(TicketAutomationState, TicketAutomationState.ticket_id == models.SpecTicket.id)
        .where(models.SpecNode.project_id == project.id, models.SpecTicket.is_deleted.is_(False))
        .order_by(models.SpecTicket.updated_at.desc())
        .limit(200)
    )
    tickets = []
    for ticket, node, state in result.all():
        tickets.append({
            "id": ticket.id,
            "key": ticket.key,
            "title": ticket.title,
            "summary": ticket.summary,
            "status": ticket.status,
            "priority": ticket.priority,
            "node_title": node.title,
            "github_issue_url": ticket.github_issue_url,
            "github_issue_number": ticket.github_issue_number,
            "automation": _state_payload(state),
        })
    await db.commit()
    return {
        "project": {"id": project.id, "slug": project.slug, "name": project.name, "github_repo": project.github_repo, "github_connected": bool(project.github_repo and project.github_token_encrypted)},
        "config": _config_payload(config, request),
        "tickets": tickets,
    }


@router.post("/api/projects/{slug}/automation/webhook-secret/rotate")
async def rotate_webhook_secret(
    slug: str,
    request: Request,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    config = await _get_or_create_config(db, project)
    raw = secrets.token_urlsafe(36)
    config.github_webhook_secret = raw
    db.add(models.AuditEvent(workspace_id=project.workspace_id, project_id=project.id, event_type="automation.webhook_secret_rotated"))
    await db.commit()
    return {"secret": raw, "webhook_url": f"{str(request.base_url).rstrip('/')}/api/projects/{slug}/automation/github-webhook"}


@router.post("/api/projects/{slug}/tickets/{ticket_id}/ai/handoff")
async def create_handoff(
    slug: str,
    ticket_id: str,
    data: HandoffRequest,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    if not project.github_repo or not project.github_token_encrypted:
        raise HTTPException(status_code=409, detail="Connect GitHub before creating an AI handoff")
    ticket, node = await _ticket(db, project, ticket_id)
    config = await _get_or_create_config(db, project)
    provider = data.provider or config.agent_kind or "web_ai"
    base_branch, base_sha = await _repo_head(project)
    state = await _get_or_create_state(db, project, ticket, provider)
    state.provider = provider
    state.base_branch = base_branch
    state.base_sha = base_sha
    state.orchestration_status = "handoff_ready"
    issue_number = ticket.github_issue_number
    issue_url = ticket.github_issue_url
    if config.auto_issue_sync or provider in {"jules", "github_label_agent"}:
        issue_number, issue_url = await _ensure_issue(project, ticket, node, base_branch, base_sha)
    should_dispatch = data.dispatch if data.dispatch is not None else bool(config.auto_dispatch_on_handoff)
    if should_dispatch and provider in {"jules", "github_label_agent"}:
        if not issue_number:
            issue_number, issue_url = await _ensure_issue(project, ticket, node, base_branch, base_sha)
        label = "jules" if provider == "jules" else (config.dispatch_label or "")
        await _dispatch_label(project, int(issue_number), label)
        state.orchestration_status = "agent_dispatched"
    db.add(models.AuditEvent(
        workspace_id=project.workspace_id,
        project_id=project.id,
        event_type="automation.ai_handoff_created",
        details={"ticket_id": ticket.id, "provider": provider, "base_sha": base_sha, "dispatched": should_dispatch},
    ))
    await db.commit()
    return {
        "prompt": _handoff_prompt(project, ticket, node, provider, base_branch, base_sha),
        "provider": provider,
        "base_branch": base_branch,
        "base_sha": base_sha,
        "github_issue_number": issue_number,
        "github_issue_url": issue_url,
        "state": _state_payload(state),
    }


@router.post("/api/projects/{slug}/tickets/{ticket_id}/ai/dispatch")
async def dispatch_agent(
    slug: str,
    ticket_id: str,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    ticket, node = await _ticket(db, project, ticket_id)
    config = await _get_or_create_config(db, project)
    if config.agent_kind not in {"jules", "github_label_agent"}:
        raise HTTPException(status_code=409, detail="The selected execution surface does not support GitHub label dispatch")
    base_branch, base_sha = await _repo_head(project)
    issue_number, issue_url = await _ensure_issue(project, ticket, node, base_branch, base_sha)
    label = "jules" if config.agent_kind == "jules" else (config.dispatch_label or "")
    await _dispatch_label(project, issue_number, label)
    state = await _get_or_create_state(db, project, ticket, config.agent_kind)
    state.provider = config.agent_kind
    state.base_branch = base_branch
    state.base_sha = base_sha
    state.orchestration_status = "agent_dispatched"
    await db.commit()
    return {"github_issue_number": issue_number, "github_issue_url": issue_url, "dispatch_label": label, "state": _state_payload(state)}


@router.post("/api/projects/{slug}/tickets/{ticket_id}/ai/apply-patch")
async def apply_ai_patch(
    slug: str,
    ticket_id: str,
    data: ApplyPatchRequest,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    ticket, _ = await _ticket(db, project, ticket_id)
    config = await _get_or_create_config(db, project)
    state = await _get_or_create_state(db, project, ticket, "web_ai")
    return await _patch_to_pr(db, project, ticket, state, config, data.ai_answer, data.base_sha)


@router.post("/api/projects/{slug}/tickets/{ticket_id}/ai/link-pr")
async def link_pull_request(
    slug: str,
    ticket_id: str,
    data: LinkPullRequestRequest,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    ticket, _ = await _ticket(db, project, ticket_id)
    config = await _get_or_create_config(db, project)
    state = await _get_or_create_state(db, project, ticket, config.agent_kind)
    await _bind_pr(db, project, ticket, state, data.pr_number)
    await _reconcile(db, project, ticket, state, config)
    return _state_payload(state)


@router.get("/api/projects/{slug}/tickets/{ticket_id}/ai/state")
async def get_ai_state(
    slug: str,
    ticket_id: str,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    ticket, _ = await _ticket(db, project, ticket_id)
    return _state_payload(await db.get(TicketAutomationState, ticket.id))


@router.post("/api/projects/{slug}/tickets/{ticket_id}/ai/reconcile")
async def reconcile_ticket(
    slug: str,
    ticket_id: str,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    ticket, _ = await _ticket(db, project, ticket_id)
    state = await db.get(TicketAutomationState, ticket.id)
    if not state:
        raise HTTPException(status_code=404, detail="Automation state not found")
    config = await _get_or_create_config(db, project)
    await _reconcile(db, project, ticket, state, config)
    return _state_payload(state)


@router.post("/api/projects/{slug}/automation/reconcile")
async def reconcile_project(
    slug: str,
    project: models.Project = Depends(_account_project),
    db: AsyncSession = Depends(get_db),
):
    config = await _get_or_create_config(db, project)
    result = await db.execute(select(TicketAutomationState).where(TicketAutomationState.project_id == project.id, TicketAutomationState.github_pr_number.is_not(None)))
    states = list(result.scalars().all())
    updated = []
    for state in states:
        ticket, _ = await _ticket(db, project, state.ticket_id)
        await _reconcile(db, project, ticket, state, config)
        updated.append(_state_payload(state))
    return {"updated": updated}


async def _state_for_webhook(
    db: AsyncSession,
    project: models.Project,
    payload: dict[str, Any],
) -> Optional[TicketAutomationState]:
    pr = payload.get("pull_request") if isinstance(payload.get("pull_request"), dict) else None
    if pr and pr.get("number"):
        result = await db.execute(select(TicketAutomationState).where(TicketAutomationState.project_id == project.id, TicketAutomationState.github_pr_number == int(pr["number"])))
        found = result.scalar_one_or_none()
        if found:
            return found
        repo = _safe_repo(project.github_repo).lower()
        if str((((pr.get("base") or {}).get("repo") or {}).get("full_name") or "")).lower() != repo:
            return None
        if str((((pr.get("head") or {}).get("repo") or {}).get("full_name") or "")).lower() != repo:
            return None
        haystack = f"{pr.get('title') or ''}\n{pr.get('body') or ''}".lower()
        tickets_result = await db.execute(
            select(models.SpecTicket)
            .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
            .where(models.SpecNode.project_id == project.id, models.SpecTicket.is_deleted.is_(False))
        )
        matches: list[models.SpecTicket] = []
        for ticket in tickets_result.scalars().all():
            key = str(ticket.key or "").lower()
            issue_ref = f"#{ticket.github_issue_number}" if ticket.github_issue_number else ""
            if (key and key in haystack) or (issue_ref and issue_ref in haystack):
                matches.append(ticket)
        if len(matches) == 1:
            ticket = matches[0]
            state = await _get_or_create_state(db, project, ticket, "external_agent")
            await _bind_pr(db, project, ticket, state, int(pr["number"]))
            return state
    head_sha = None
    if isinstance(payload.get("check_run"), dict):
        head_sha = payload["check_run"].get("head_sha")
    elif isinstance(payload.get("check_suite"), dict):
        head_sha = payload["check_suite"].get("head_sha")
    elif isinstance(payload.get("deployment"), dict):
        head_sha = payload["deployment"].get("sha")
    if head_sha:
        result = await db.execute(select(TicketAutomationState).where(TicketAutomationState.project_id == project.id, TicketAutomationState.head_sha == str(head_sha)).limit(1))
        return result.scalar_one_or_none()
    return None


@router.post("/api/projects/{slug}/automation/github-webhook")
async def github_automation_webhook(
    slug: str,
    request: Request,
    x_hub_signature_256: Optional[str] = Header(default=None, alias="X-Hub-Signature-256"),
    x_github_event: Optional[str] = Header(default=None, alias="X-GitHub-Event"),
    db: AsyncSession = Depends(get_db),
):
    project_result = await db.execute(select(models.Project).where(models.Project.slug == slug, models.Project.is_deleted.is_(False)))
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    config = await db.get(ProjectAutomationConfig, project.id)
    if not config or not config.github_webhook_secret_encrypted:
        raise HTTPException(status_code=404, detail="Automation webhook is not configured")
    raw = await request.body()
    if len(raw) > 1_000_000:
        raise HTTPException(status_code=413, detail="Webhook payload is too large")
    secret = config.github_webhook_secret or ""
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    if not x_hub_signature_256 or not hmac.compare_digest(expected, x_hub_signature_256):
        raise HTTPException(status_code=401, detail="Invalid GitHub webhook signature")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid GitHub webhook payload") from exc
    repo = str(((payload.get("repository") or {}).get("full_name") or ""))
    if repo.lower() != _safe_repo(project.github_repo).lower():
        raise HTTPException(status_code=403, detail="Webhook repository does not match this project")
    if x_github_event == "ping":
        return {"ok": True, "event": "ping"}
    if x_github_event not in {"pull_request", "check_run", "check_suite", "deployment_status"}:
        return {"ok": True, "ignored": True}
    state = await _state_for_webhook(db, project, payload)
    if not state:
        return {"ok": True, "matched": False}
    ticket, _ = await _ticket(db, project, state.ticket_id)
    await _reconcile(db, project, ticket, state, config)
    return {"ok": True, "matched": True, "state": _state_payload(state)}
