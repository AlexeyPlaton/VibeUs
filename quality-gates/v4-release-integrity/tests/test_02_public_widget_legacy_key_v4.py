from __future__ import annotations

import uuid

import pytest


@pytest.mark.blocker
@pytest.mark.security
@pytest.mark.asyncio
async def test_legacy_project_without_public_key_digest_fails_closed(api_client, fresh_backend):
    rt = fresh_backend
    slug = f"legacy-no-widget-key-{uuid.uuid4().hex[:8]}"
    async with rt.database.async_session() as db:
        ws = rt.models.Workspace(name="Legacy widget WS", owner_email="legacy-widget@example.test")
        db.add(ws)
        await db.flush()
        project = rt.models.Project(
            workspace_id=ws.id,
            name="Legacy no-key project",
            slug=slug,
            api_token_digest=rt.security.hash_access_token("vb_live_legacy_owner_v4"),
            public_widget_key=None,
            public_widget_key_digest=None,
            public_widget_origins=[],
            is_deleted=False,
        )
        db.add(project)
        await db.commit()

    res = await api_client.post(
        f"/api/projects/{slug}/feedback",
        headers={"X-Public-Widget-Key": "any-non-empty-string-must-not-work"},
        json={"text": "unauthorized legacy-key probe"},
    )
    assert res.status_code in {401, 403}, (
        "A project with no configured public_widget_key_digest accepted an arbitrary key. "
        "Missing credentials must fail closed and require owner-side key rotation/provisioning."
    )


@pytest.mark.blocker
@pytest.mark.security
@pytest.mark.asyncio
async def test_public_feedback_still_works_with_real_configured_public_key(api_client, fresh_backend):
    """Prevents an agent from 'fixing' the previous test by disabling public feedback."""
    rt = fresh_backend
    slug = f"configured-widget-{uuid.uuid4().hex[:8]}"
    raw_key = "vb_pub_qgv4_valid_widget_key"
    async with rt.database.async_session() as db:
        ws = rt.models.Workspace(name="Configured widget WS", owner_email="configured-widget@example.test")
        db.add(ws)
        await db.flush()
        project = rt.models.Project(
            workspace_id=ws.id,
            name="Configured public widget",
            slug=slug,
            api_token_digest=rt.security.hash_access_token("vb_live_configured_owner_v4"),
            public_widget_key=raw_key,
            public_widget_key_digest=rt.security.hash_access_token(raw_key),
            public_widget_origins=[],
            is_deleted=False,
        )
        db.add(project)
        await db.commit()

    res = await api_client.post(
        f"/api/projects/{slug}/feedback",
        headers={"X-Public-Widget-Key": raw_key, "Idempotency-Key": f"qgv4-{uuid.uuid4().hex}"},
        json={"text": "authorized public feedback remains functional"},
    )
    assert res.status_code == 200, res.text
