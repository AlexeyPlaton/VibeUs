import pytest
from fastapi import HTTPException

import ai_patch
from ai_orchestration_models import DEFAULT_PROTECTED_PATHS
from main import app


def test_ai_orchestration_routes_are_registered_without_auto_merge():
    paths = {getattr(route, "path", "") for route in app.router.routes}
    assert "/api/projects/{slug}/automation/overview" in paths
    assert "/api/projects/{slug}/tickets/{ticket_id}/ai/handoff" in paths
    assert "/api/projects/{slug}/tickets/{ticket_id}/ai/apply-patch" in paths
    assert "/api/projects/{slug}/tickets/{ticket_id}/ai/link-pr" in paths
    assert "/api/projects/{slug}/tickets/{ticket_id}/ai/reconcile" in paths
    assert "/api/projects/{slug}/automation/github-webhook" in paths
    assert not any("/ai/merge" in path or "/automation/merge" in path for path in paths)


def test_vibeus_patch_envelope_and_unified_diff_apply_cleanly():
    answer = """Some model commentary.

VIBEUS-PATCH v1
ticket: VB-142
repository: acme/shop
base_sha: 0123456789012345678901234567890123456789
---PATCH---
diff --git a/src/example.txt b/src/example.txt
--- a/src/example.txt
+++ b/src/example.txt
@@ -1,2 +1,2 @@
 hello
-old
+new
---END PATCH---
"""
    metadata, patch_text = ai_patch.extract_patch_envelope(answer)
    assert metadata["ticket"] == "VB-142"
    assert metadata["repository"] == "acme/shop"
    patches = ai_patch.parse_unified_diff(patch_text)
    assert len(patches) == 1
    assert patches[0].target_path == "src/example.txt"
    assert ai_patch.apply_file_patch("hello\nold\n", patches[0]) == "hello\nnew\n"


def test_patch_context_mismatch_fails_closed():
    patch = ai_patch.parse_unified_diff(
        """diff --git a/src/example.txt b/src/example.txt
--- a/src/example.txt
+++ b/src/example.txt
@@ -1,1 +1,1 @@
-old
+new
"""
    )[0]
    with pytest.raises(HTTPException) as exc:
        ai_patch.apply_file_patch("different\n", patch)
    assert exc.value.status_code == 409


@pytest.mark.parametrize(
    "path",
    [
        ".env",
        ".env.production",
        ".github/workflows/deploy.yml",
        "deploy/release.sh",
        "openspec-core/alembic/versions/evil.py",
        "certs/private.pem",
    ],
)
def test_web_ai_bridge_protects_release_and_secret_paths(path):
    assert ai_patch.path_is_protected(path, list(DEFAULT_PROTECTED_PATHS)) is True


def test_normal_application_source_is_not_blocked():
    assert ai_patch.path_is_protected(
        "openspec-web/src/components/Button.tsx",
        list(DEFAULT_PROTECTED_PATHS),
    ) is False


def test_sanitized_handoff_context_redacts_secret_shaped_keys():
    value = {
        "url": "https://example.test/checkout",
        "authorization": "Bearer top-secret",
        "nested": {"apiToken": "abc", "selector": "#pay"},
    }
    safe = ai_patch.sanitize_context(value)
    assert safe["url"] == value["url"]
    assert safe["authorization"] == "[REDACTED]"
    assert safe["nested"]["apiToken"] == "[REDACTED]"
    assert safe["nested"]["selector"] == "#pay"


def test_deletion_patch_distinguishes_full_and_partial_removal():
    full_delete = ai_patch.parse_unified_diff(
        """diff --git a/a.txt b/a.txt
deleted file mode 100644
--- a/a.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
"""
    )[0]
    assert ai_patch.apply_file_patch("one\ntwo\n", full_delete) == ""

    partial_delete = ai_patch.parse_unified_diff(
        """diff --git a/a.txt b/a.txt
--- a/a.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-one
"""
    )[0]
    assert ai_patch.apply_file_patch("one\ntwo\n", partial_delete) == "two\n"
