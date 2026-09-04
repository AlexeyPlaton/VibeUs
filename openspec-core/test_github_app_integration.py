import github_app_integration
from main import app


def _call_for(path: str, method: str):
    method = method.upper()
    for route in app.router.routes:
        if getattr(route, "path", None) == path and method in (getattr(route, "methods", None) or set()):
            return route.dependant.call
    raise AssertionError(f"missing route {method} {path}")


def test_ai_handoff_uses_app_first_runtime_call():
    call = _call_for("/api/projects/{slug}/tickets/{ticket_id}/ai/handoff", "POST")
    assert call.__module__ == "integration_extensions"
    assert call.__name__ == "create_handoff"


def test_legacy_account_github_routes_are_migrated_to_app_first_runtime():
    expected = {
        ("/api/projects/{slug}/github", "GET"): "legacy_get_github_config",
        ("/api/projects/{slug}/github/test", "POST"): "legacy_test_github_endpoint",
        ("/api/projects/{slug}/github/sync", "POST"): "legacy_sync_all",
        ("/api/projects/{slug}/tickets/{ticket_id}/github/sync", "POST"): "legacy_sync_single",
    }
    for (path, method), name in expected.items():
        call = _call_for(path, method)
        assert call.__module__ == "integration_extensions"
        assert call.__name__ == name


def test_github_app_onboarding_uses_signed_state_and_no_browser_installation_id_binding():
    paths = {getattr(route, "path", "") for route in app.router.routes}
    assert "/api/projects/{slug}/github/app/connect" in paths
    assert "/api/projects/{slug}/github/app/install-intent" in paths
    assert "/api/github/app/install/complete" in paths
    assert not any("installation_id" in path for path in paths)
    assert "installation_id" not in github_app_integration.GitHubAppInstallIntentRequest.model_fields
    assert "installation_id" not in github_app_integration.GitHubAppInstallCompleteRequest.model_fields


def test_github_app_onboarding_routes_are_attached_to_final_runtime():
    intent = _call_for("/api/projects/{slug}/github/app/install-intent", "POST")
    complete = _call_for("/api/github/app/install/complete", "POST")
    assert intent.__module__ == "github_app_integration"
    assert complete.__module__ == "github_app_integration"
