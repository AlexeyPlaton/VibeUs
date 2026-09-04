from main import app
import preview_adapters


def test_vercel_preview_requires_exact_sha_ready_and_non_production():
    sha = "a" * 40
    payload = {
        "deployments": [
            {"readyState": "READY", "target": "production", "url": "prod.example.dev", "meta": {"githubCommitSha": sha}},
            {"readyState": "READY", "target": None, "url": "wrong.example.dev", "meta": {"githubCommitSha": "b" * 40}},
            {"readyState": "BUILDING", "target": None, "url": "building.example.dev", "meta": {"githubCommitSha": sha}},
            {"readyState": "READY", "target": None, "url": "review.example.dev", "meta": {"githubCommitSha": sha}},
        ]
    }
    assert preview_adapters.vercel_preview_url(payload, sha) == "https://review.example.dev"


def test_vercel_preview_accepts_git_source_sha_without_token_shape_assumptions():
    sha = "c" * 40
    payload = {"deployments": [{"state": "READY", "target": "preview", "url": "https://preview.example.dev", "gitSource": {"sha": sha}}]}
    assert preview_adapters.vercel_preview_url(payload, sha) == "https://preview.example.dev"


def test_render_preview_requires_live_exact_commit():
    sha = "d" * 40
    assert preview_adapters.render_deploy_matches([
        {"deploy": {"status": "build_in_progress", "commit": {"id": sha}}},
        {"deploy": {"status": "live", "commit": {"id": "e" * 40}}},
        {"deploy": {"status": "live", "commit": {"id": sha}}},
    ], sha) is True
    assert preview_adapters.render_deploy_matches([
        {"deploy": {"status": "live", "commit": {"id": "e" * 40}}},
    ], sha) is False


def test_preview_and_github_app_routes_are_registered_without_deploy_trigger():
    routes = {(getattr(route, "path", ""), tuple(sorted(getattr(route, "methods", None) or []))) for route in app.router.routes}
    paths = {path for path, _methods in routes}
    assert "/api/projects/{slug}/github/app" in paths
    assert "/api/projects/{slug}/github/app/connect" in paths
    assert "/api/projects/{slug}/github/pat" in paths
    assert "/api/projects/{slug}/automation/preview" in paths
    assert "/api/projects/{slug}/automation/preview/test" in paths
    assert not any(path.endswith("/automation/preview/deploy") for path in paths)
