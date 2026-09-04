from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request

import main  # installs the effective orchestration runtime contracts
import ai_orchestration
from ai_orchestration_models import ProjectAutomationConfig


class FakeDB:
    def __init__(self, config=None):
        self.config = config
        self.commits = 0
        self.added = []

    async def get(self, model, key):
        return self.config

    async def flush(self):
        return None

    async def commit(self):
        self.commits += 1

    def add(self, value):
        self.added.append(value)


def request_for(slug: str) -> Request:
    return Request({
        "type": "http",
        "method": "GET",
        "scheme": "https",
        "server": ("vibeus.pro", 443),
        "root_path": "",
        "path": f"/api/projects/{slug}/automation/overview",
        "raw_path": f"/api/projects/{slug}/automation/overview".encode(),
        "query_string": b"",
        "headers": [(b"host", b"vibeus.pro")],
        "path_params": {"slug": slug},
    })


def config(**overrides):
    values = dict(
        project_id="project-uuid",
        autonomy_mode="assisted",
        agent_kind="web_ai",
        dispatch_label="",
        auto_issue_sync=True,
        auto_dispatch_on_handoff=False,
        create_pr_from_patch=True,
        observe_ci=True,
        observe_preview=True,
        auto_move_to_review=True,
        max_repair_attempts=2,
        merge_policy="human_accept",
        protected_paths=[],
        github_webhook_secret_encrypted=None,
    )
    values.update(overrides)
    return SimpleNamespace(**values)


def test_webhook_callback_uses_public_project_slug_not_internal_uuid():
    payload = ai_orchestration._config_payload(config(), request_for("shop-web"))
    assert payload["webhook_url"] == "https://vibeus.pro/api/projects/shop-web/automation/github-webhook"
    assert "project-uuid" not in payload["webhook_url"]


@pytest.mark.asyncio
async def test_autopilot_dispatch_is_derived_only_for_dispatch_capable_agents():
    project = SimpleNamespace(id="project-uuid")

    jules = config(autonomy_mode="autopilot_pr", agent_kind="jules", auto_dispatch_on_handoff=False)
    returned = await ai_orchestration._get_or_create_config(FakeDB(jules), project)
    assert returned.auto_dispatch_on_handoff is True

    web_ai = config(autonomy_mode="autopilot_pr", agent_kind="web_ai", auto_dispatch_on_handoff=True)
    returned = await ai_orchestration._get_or_create_config(FakeDB(web_ai), project)
    assert returned.auto_dispatch_on_handoff is False


@pytest.mark.asyncio
async def test_preview_discovery_is_best_effort_without_deployments_permission(monkeypatch):
    async def no_deployments(*args, **kwargs):
        raise HTTPException(status_code=502, detail="GitHub: Resource not accessible by personal access token")

    monkeypatch.setattr(ai_orchestration, "_gh", no_deployments)
    assert await ai_orchestration._preview_url(SimpleNamespace(), "a" * 40) is None


@pytest.mark.asyncio
async def test_actions_only_ci_does_not_stick_on_empty_legacy_status_api(monkeypatch):
    head_sha = "b" * 40

    async def github(project, method, path, **kwargs):
        if path == "/pulls/42":
            return {
                "number": 42,
                "state": "open",
                "merged_at": None,
                "html_url": "https://github.com/acme/shop/pull/42",
                "head": {"sha": head_sha, "ref": "vibeus/vb-42"},
            }
        if path == f"/commits/{head_sha}/check-runs":
            return {
                "total_count": 1,
                "check_runs": [{"name": "CI", "status": "completed", "conclusion": "success"}],
            }
        if path == f"/commits/{head_sha}/status":
            return {"state": "pending", "total_count": 0, "statuses": []}
        raise AssertionError(path)

    monkeypatch.setattr(ai_orchestration, "_gh", github)
    monkeypatch.setattr(ai_orchestration, "criteria_auto_review_ready", lambda ticket: (False, ["trusted evidence"]))

    state = SimpleNamespace(
        github_pr_number=42,
        head_sha=None,
        github_pr_url=None,
        branch_name=None,
        ci_state="pending",
        orchestration_status="pr_open",
        last_check_summary={},
        last_failed_head_sha=None,
        repair_attempts=0,
        provider="web_ai",
        preview_url=None,
    )
    project = SimpleNamespace(id="project-id", workspace_id="workspace-id", revision=0)
    ticket = SimpleNamespace(id="ticket-id", status="in_progress", revision=0)
    cfg = config(observe_preview=False)
    db = FakeDB()

    result = await ai_orchestration._reconcile(db, project, ticket, state, cfg)
    assert result.ci_state == "success"
    assert result.orchestration_status == "ci_green_evidence_pending"
    assert result.last_check_summary["combined"] == "none"
    assert result.last_check_summary["combined_total"] == 0


@pytest.mark.asyncio
async def test_review_ready_reconciliation_broadcasts_board_refresh_after_commit(monkeypatch):
    import main_legacy

    head_sha = "c" * 40

    async def github(project, method, path, **kwargs):
        if path == "/pulls/77":
            return {
                "number": 77,
                "state": "open",
                "merged_at": None,
                "html_url": "https://github.com/acme/shop/pull/77",
                "head": {"sha": head_sha, "ref": "vibeus/vb-77"},
            }
        if path == f"/commits/{head_sha}/check-runs":
            return {
                "total_count": 1,
                "check_runs": [{"name": "CI", "status": "completed", "conclusion": "success"}],
            }
        if path == f"/commits/{head_sha}/status":
            return {"state": "pending", "total_count": 0, "statuses": []}
        raise AssertionError(path)

    broadcasts = []

    async def broadcast(payload, project_id):
        broadcasts.append((payload, project_id))

    monkeypatch.setattr(ai_orchestration, "_gh", github)
    monkeypatch.setattr(ai_orchestration, "criteria_auto_review_ready", lambda ticket: (True, []))
    monkeypatch.setattr(main_legacy.manager, "broadcast", broadcast)

    state = SimpleNamespace(
        github_pr_number=77,
        head_sha=None,
        github_pr_url=None,
        branch_name=None,
        ci_state="pending",
        orchestration_status="pr_open",
        last_check_summary={},
        last_failed_head_sha=None,
        repair_attempts=0,
        provider="web_ai",
        preview_url=None,
    )
    project = SimpleNamespace(id="project-id", workspace_id="workspace-id", revision=4)
    ticket = SimpleNamespace(id="ticket-id", status="in_progress", revision=2)
    cfg = config(observe_preview=False, auto_move_to_review=True)
    db = FakeDB()

    result = await ai_orchestration._reconcile(db, project, ticket, state, cfg)

    assert result.orchestration_status == "review_ready"
    assert ticket.status == "review"
    assert ticket.revision == 3
    assert project.revision == 5
    assert db.commits == 1
    assert broadcasts == [({"type": "board.refresh", "revision": 5}, "project-id")]
