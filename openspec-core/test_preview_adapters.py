import pytest

import preview_adapters
from main import app


HEAD = "a" * 40


def test_vercel_preview_requires_ready_exact_sha_and_non_production():
    payload = {
        "deployments": [
            {"readyState": "READY", "target": "production", "url": "prod.vercel.app", "meta": {"githubCommitSha": HEAD}},
            {"readyState": "BUILDING", "target": None, "url": "building.vercel.app", "meta": {"githubCommitSha": HEAD}},
            {"readyState": "READY", "target": None, "url": "wrong.vercel.app", "meta": {"githubCommitSha": "b" * 40}},
            {"readyState": "READY", "target": None, "url": "safe.vercel.app", "gitSource": {"sha": HEAD}},
        ]
    }
    assert preview_adapters.vercel_preview_url(payload, HEAD) == "https://safe.vercel.app"
    assert preview_adapters.vercel_response_is_preview({"target": None}) is True
    assert preview_adapters.vercel_response_is_preview({"target": "preview"}) is True
    assert preview_adapters.vercel_response_is_preview({"target": "production"}) is False


def test_github_safe_preview_requires_explicit_non_production_environment():
    assert preview_adapters.github_deployment_is_safe_preview({
        "environment": "vibeus-preview/pr-42",
        "transient_environment": True,
        "production_environment": False,
    }) is True
    assert preview_adapters.github_deployment_is_safe_preview({
        "environment": "production",
        "transient_environment": False,
        "production_environment": True,
    }) is False
    assert preview_adapters.github_deployment_is_safe_preview({
        "environment": "unknown",
        "production_environment": False,
    }) is False


def test_github_preview_request_is_exact_sha_transient_and_never_production():
    body = preview_adapters.github_preview_deployment_body(HEAD, 42)
    assert body["ref"] == HEAD
    assert body["environment"] == "vibeus-preview/pr-42"
    assert body["auto_merge"] is False
    assert body["required_contexts"] == []
    assert body["transient_environment"] is True
    assert body["production_environment"] is False
    assert body["payload"]["head_sha"] == HEAD


def test_vercel_request_is_git_bound_and_omits_target():
    project = {
        "name": "shop-web",
        "link": {
            "type": "github",
            "repoId": 123,
            "productionBranch": "main",
        },
    }
    body = preview_adapters.vercel_preview_request_body(
        project,
        github_repo_id=123,
        branch_name="vibeus/vb-42-fix",
        head_sha=HEAD,
        provider_project_id="prj_123",
        pr_number=42,
    )
    assert body["project"] == "prj_123"
    assert body["gitSource"] == {
        "type": "github",
        "ref": "vibeus/vb-42-fix",
        "repoId": 123,
        "sha": HEAD,
    }
    assert "target" not in body
    assert "customEnvironmentSlugOrId" not in body


@pytest.mark.parametrize(
    "project,repo_id,branch,error",
    [
        ({"name": "x", "link": {"type": "github", "repoId": 123, "productionBranch": "main"}}, 999, "feature", "different GitHub repository"),
        ({"name": "x", "link": {"type": "github", "repoId": 123, "productionBranch": "main"}}, 123, "main", "production branch"),
        ({"name": "x", "link": {"type": "github", "repoId": 123}}, 123, "feature", "production branch could not be verified"),
    ],
)
def test_vercel_request_fails_closed_when_repository_or_production_boundary_is_uncertain(project, repo_id, branch, error):
    with pytest.raises(ValueError, match=error):
        preview_adapters.vercel_preview_request_body(
            project,
            github_repo_id=repo_id,
            branch_name=branch,
            head_sha=HEAD,
            provider_project_id="prj_123",
            pr_number=42,
        )


def test_preview_routes_expose_safe_request_but_no_production_delivery_surface():
    paths = {getattr(route, "path", "") for route in app.router.routes}
    assert "/api/projects/{slug}/automation/preview" in paths
    assert "/api/projects/{slug}/automation/preview/test" in paths
    assert "/api/projects/{slug}/tickets/{ticket_id}/automation/preview/deploy" in paths
    assert not any("/production" in path for path in paths if "/automation/preview" in path)
    assert not any("/promote" in path for path in paths if "/automation/preview" in path)


def test_render_safe_trigger_is_pr_label_not_render_service_deploy():
    source = open(preview_adapters.__file__, encoding="utf-8").read()
    assert "render-preview" in source
    assert "/issues/{int(state.github_pr_number or 0)}/labels" in source
    assert "api.render.com" not in source
    assert "/v1/services/" not in source
