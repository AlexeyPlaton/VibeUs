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


def test_github_app_surface_has_no_browser_installation_id_binding_endpoint():
    paths = {getattr(route, "path", "") for route in app.router.routes}
    assert "/api/projects/{slug}/github/app/connect" in paths
    assert not any("installation_id" in path for path in paths)
