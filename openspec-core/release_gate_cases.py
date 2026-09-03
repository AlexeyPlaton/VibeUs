from datetime import timedelta
from types import SimpleNamespace
import json
from urllib.parse import urlsplit, parse_qs

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

import entitlements
import main
import models
import security
import yookassa_service
import manage_receipts
from database import get_db
from main import app
from models import Base

SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

async def override_get_db():
    async with TestingSessionLocal() as session:
        yield session

@pytest_asyncio.fixture(autouse=True)
async def prepare_database():
    original_session = main.async_session
    original_engine = main.engine
    main.async_session = TestingSessionLocal
    main.engine = engine
    main.limiter.enabled = False
    app.dependency_overrides[get_db] = override_get_db
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    main.async_session = original_session
    main.engine = original_engine
    main.limiter.enabled = True

@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

async def register_login(client: AsyncClient, email="release@test.dev") -> dict:
    reg = await client.post("/api/auth/register", json={
        "email": email,
        "password": "Correct-Horse-42!Battery",
        "accept_terms": True,
        "terms_version": "test-v1",
        "privacy_version": "test-v1",
    })
    assert reg.status_code == 200, reg.text
    login = await client.post("/api/auth/login", json={
        "email": email,
        "password": "Correct-Horse-42!Battery",
    })
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def register_browser_login(client: AsyncClient, email="browser@test.dev") -> None:
    reg = await client.post("/api/auth/register", json={
        "email": email,
        "password": "Correct-Horse-42!Battery",
        "accept_terms": True,
        "terms_version": "test-v1",
        "privacy_version": "test-v1",
    })
    assert reg.status_code == 200, reg.text
    login = await client.post("/api/auth/browser-login", json={
        "email": email,
        "password": "Correct-Horse-42!Battery",
    })
    assert login.status_code == 200, login.text
    assert "access_token" not in login.json()
    assert "HttpOnly" in login.headers.get("set-cookie", "")

async def workspace(client: AsyncClient, headers: dict) -> str:
    res = await client.post("/api/workspaces", json={"name": "Release Gate"}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()["id"]

@pytest.mark.asyncio
async def test_registration_requires_contract_acceptance_and_records_version(client: AsyncClient):
    rejected = await client.post("/api/auth/register", json={
        "email": "noaccept@test.dev",
        "password": "Correct-Horse-42!Battery",
        "accept_terms": False,
        "terms_version": "v1",
        "privacy_version": "v1",
    })
    assert rejected.status_code == 422

    accepted = await client.post("/api/auth/register", json={
        "email": "accepted@test.dev",
        "password": "Correct-Horse-42!Battery",
        "accept_terms": True,
        "terms_version": "2026-08-31",
        "privacy_version": "2026-08-31",
    })
    assert accepted.status_code == 200

    async with TestingSessionLocal() as db:
        user = (await db.execute(select(models.User).where(models.User.email == "accepted@test.dev"))).scalar_one()
        assert user.terms_version == "2026-08-31"
        assert user.terms_accepted_at is not None
        assert user.privacy_acknowledged_at is not None
        audit = (await db.execute(select(models.AuditEvent).where(models.AuditEvent.user_id == user.id))).scalars().all()
        assert any(row.event_type == "legal.account_terms_accepted" for row in audit)

@pytest.mark.asyncio
async def test_cookie_mutation_requires_trusted_origin(client: AsyncClient):
    await register_browser_login(client, "cookie@test.dev")
    # No Bearer header: this is ambient cookie auth and must carry a trusted Origin.
    rejected = await client.post("/api/workspaces", json={"name": "CSRF target"})
    assert rejected.status_code == 403
    assert rejected.json()["error"]["code"] == "CSRF_ORIGIN_REJECTED"

    accepted = await client.post(
        "/api/workspaces",
        json={"name": "Browser workspace"},
        headers={"Origin": "http://localhost:5173"},
    )
    assert accepted.status_code == 200

@pytest.mark.asyncio
async def test_project_creation_requires_explicit_workspace(client: AsyncClient):
    headers = await register_login(client, "tenant@test.dev")
    missing = await client.post("/api/projects", json={"name": "No Parent", "slug": "no-parent"}, headers=headers)
    assert missing.status_code == 422

    ws_id = await workspace(client, headers)
    ok = await client.post("/api/projects", json={"name": "Scoped", "slug": "scoped", "workspace_id": ws_id}, headers=headers)
    assert ok.status_code == 200
    assert ok.json()["workspace_id"] == ws_id

@pytest.mark.asyncio
async def test_public_widget_origin_allowlist_is_not_optional(client: AsyncClient):
    headers = await register_login(client, "origin@test.dev")
    ws_id = await workspace(client, headers)
    project = await client.post("/api/projects", json={
        "name": "Origin Guard",
        "slug": "origin-guard",
        "workspace_id": ws_id,
        "public_widget_origins": ["https://client.example"],
    }, headers=headers)
    assert project.status_code == 200
    public_key = project.json()["public_widget_key"]
    payload = {"text": "Button is misaligned", "category": "bug"}

    missing = await client.post(
        "/api/projects/origin-guard/feedback",
        json=payload,
        headers={"X-Vibus-Public-Key": public_key},
    )
    assert missing.status_code == 403

    wrong = await client.post(
        "/api/projects/origin-guard/feedback",
        json=payload,
        headers={"X-Vibus-Public-Key": public_key, "Origin": "https://evil.example"},
    )
    assert wrong.status_code == 403

    ok = await client.post(
        "/api/projects/origin-guard/feedback",
        json=payload,
        headers={"X-Vibus-Public-Key": public_key, "Origin": "https://client.example"},
    )
    assert ok.status_code == 200

@pytest.mark.asyncio
async def test_preview_link_exchanges_for_preview_only_http_only_session(client: AsyncClient):
    headers = await register_login(client, "preview@test.dev")
    ws_id = await workspace(client, headers)
    project = await client.post("/api/projects", json={"name": "Preview", "slug": "preview-proj", "workspace_id": ws_id}, headers=headers)
    assert project.status_code == 200
    project_token = project.json()["token"]

    tunnel = await client.post(
        "/api/projects/preview-proj/tunnels",
        json={"target_port": 5173, "ttl": "24h", "role": "reviewer", "single_use": True},
        headers={"X-API-Token": project_token},
    )
    assert tunnel.status_code == 200, tunnel.text
    data = tunnel.json()
    fragment = parse_qs(urlsplit(data["preview_url"]).fragment)
    access_token = fragment["vibus_token"][0]

    owner_board = await client.get("/api/projects/preview-proj/board", headers={"X-API-Token": project_token})
    node_id = owner_board.json()["nodes"][0]["id"]
    created_ticket = await client.post(
        f"/api/projects/preview-proj/nodes/{node_id}/tickets",
        json={"title": "Review me", "status": "review", "priority": "medium"},
        headers={"X-API-Token": project_token},
    )
    assert created_ticket.status_code == 200, created_ticket.text
    review_ticket_id = created_ticket.json()["id"]

    # Separate preview origin intentionally does not inherit the VibeUs account cookie.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://localhost:8000") as preview_client:
        exchanged = await preview_client.post("/api/preview/sessions/exchange", json={
            "tunnel_id": data["tunnel_id"],
            "token": access_token,
            "fingerprint": "browser-A",
        })
        assert exchanged.status_code == 200, exchanged.text
        set_cookie = exchanged.headers.get("set-cookie", "")
        assert "HttpOnly" in set_cookie
        assert "Path=/" in set_cookie
        assert "Domain=" not in set_cookie

        # The raw access-link bearer is no longer needed after the exchange;
        # the isolated preview host authenticates board reads by HttpOnly cookie.
        board = await preview_client.get("/api/projects/preview-proj/board")
        assert board.status_code == 200, board.text

        reviewed = await preview_client.post(
            f"/api/projects/preview-proj/tickets/{review_ticket_id}/review",
            json={"action": "accept", "rework_notes": ""},
            headers={"Origin": "http://localhost:8000"},
        )
        assert reviewed.status_code == 200, reviewed.text
        assert reviewed.json()["status"] == "done"

        # Reviewer capability is deliberately narrow: arbitrary ticket edits remain forbidden.
        forbidden_edit = await preview_client.put(
            f"/api/projects/preview-proj/tickets/{review_ticket_id}",
            json={"priority": "critical"},
            headers={"Origin": "http://localhost:8000"},
        )
        assert forbidden_edit.status_code == 403

        replay_other_device = await preview_client.post("/api/preview/sessions/exchange", json={
            "tunnel_id": data["tunnel_id"],
            "token": access_token,
            "fingerprint": "browser-B",
        }, headers={"Origin": "http://localhost:8000"})
        assert replay_other_device.status_code == 403


def test_entitlement_expires_even_when_tier_string_stays_paid():
    now = models.utcnow()
    active = models.Workspace(
        name="Active", owner_email="a@test.dev", subscription_tier="solo",
        subscription_status="active", current_period_end=now + timedelta(minutes=1),
    )
    expired = models.Workspace(
        name="Expired", owner_email="e@test.dev", subscription_tier="studio",
        subscription_status="active", current_period_end=now - timedelta(seconds=1),
    )
    assert entitlements.effective_tier(active, now) == "solo"
    assert entitlements.effective_tier(expired, now) == "free"


def test_password_hash_is_argon2_and_legacy_pbkdf2_can_still_verify():
    password = "Correct-Horse-42!Battery"
    modern = security.get_password_hash(password)
    assert modern.startswith("$argon2id$")
    assert security.verify_password(password, modern)
    assert not security.verify_password(password + "x", modern)

    # Recreate the historical VibeUs PBKDF2 representation for migration coverage.
    import hashlib
    salt = "legacy-salt"
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 600000).hex()
    legacy = f"{salt}${digest}"
    assert security.verify_password(password, legacy)
    assert security.password_needs_rehash(legacy)

def test_protected_field_decrypt_fails_closed_instead_of_returning_ciphertext():
    encrypted = security.encrypt_field("github_pat_secret")
    assert encrypted and encrypted != "github_pat_secret"
    assert security.decrypt_field(encrypted) == "github_pat_secret"
    with pytest.raises(RuntimeError):
        security.decrypt_field(encrypted[:-2] + "xx")
@pytest.mark.asyncio
async def test_account_dashboard_lists_projects_and_rotates_keys(client: AsyncClient):
    headers = await register_login(client, "dashboard@test.dev")
    ws_id = await workspace(client, headers)
    created = await client.post(
        "/api/projects",
        json={"name": "Dashboard Project", "slug": "dashboard-project", "workspace_id": ws_id},
        headers=headers,
    )
    assert created.status_code == 200, created.text
    original_api = created.json()["token"]
    original_public = created.json()["public_widget_key"]

    listing = await client.get(f"/api/workspaces/{ws_id}/projects", headers=headers)
    assert listing.status_code == 200, listing.text
    assert listing.json()[0]["public_widget_key"] == original_public
    assert "token" not in listing.json()[0]

    rotated_api = await client.post(
        f"/api/workspaces/{ws_id}/projects/dashboard-project/rotate-api-token",
        headers=headers,
    )
    assert rotated_api.status_code == 200, rotated_api.text
    new_api = rotated_api.json()["token"]
    assert new_api != original_api
    assert (await client.get("/api/projects/dashboard-project", headers={"X-API-Token": original_api})).status_code in {401, 404}
    assert (await client.get("/api/projects/dashboard-project", headers={"X-API-Token": new_api})).status_code == 200

    rotated_public = await client.post(
        f"/api/workspaces/{ws_id}/projects/dashboard-project/rotate-public-key",
        headers=headers,
    )
    assert rotated_public.status_code == 200, rotated_public.text
    new_public = rotated_public.json()["public_widget_key"]
    assert new_public != original_public

    old_feedback = await client.post(
        "/api/projects/dashboard-project/feedback",
        json={"text": "old public key must stop working"},
        headers={"X-Vibus-Public-Key": original_public},
    )
    assert old_feedback.status_code == 403
    new_feedback = await client.post(
        "/api/projects/dashboard-project/feedback",
        json={"text": "new public key works"},
        headers={"X-Vibus-Public-Key": new_public},
    )
    assert new_feedback.status_code == 200, new_feedback.text


@pytest.mark.asyncio
async def test_old_public_key_row_can_be_reissued_from_dashboard(client: AsyncClient):
    headers = await register_login(client, "legacy-public@test.dev")
    ws_id = await workspace(client, headers)
    created = await client.post(
        "/api/projects",
        json={"name": "Legacy", "slug": "legacy-key", "workspace_id": ws_id},
        headers=headers,
    )
    assert created.status_code == 200

    async with TestingSessionLocal() as db:
        project = (await db.execute(select(models.Project).where(models.Project.slug == "legacy-key"))).scalar_one()
        project.public_widget_key = None
        await db.commit()

    listing = await client.get(f"/api/workspaces/{ws_id}/projects", headers=headers)
    assert listing.json()[0]["public_widget_key"] is None

    rotated = await client.post(
        f"/api/workspaces/{ws_id}/projects/legacy-key/rotate-public-key",
        headers=headers,
    )
    assert rotated.status_code == 200
    assert rotated.json()["public_widget_key"].startswith("vb_pub_")


@pytest.mark.asyncio
async def test_account_delete_releases_free_project_slot(client: AsyncClient):
    headers = await register_login(client, "slot@test.dev")
    ws_id = await workspace(client, headers)
    first = await client.post(
        "/api/projects",
        json={"name": "First", "slug": "first-slot", "workspace_id": ws_id},
        headers=headers,
    )
    assert first.status_code == 200
    blocked = await client.post(
        "/api/projects",
        json={"name": "Second", "slug": "second-slot", "workspace_id": ws_id},
        headers=headers,
    )
    assert blocked.status_code == 402

    deleted = await client.delete(
        f"/api/workspaces/{ws_id}/projects/first-slot?confirmation_slug=first-slot",
        headers=headers,
    )
    assert deleted.status_code == 200, deleted.text

    second = await client.post(
        "/api/projects",
        json={"name": "Second", "slug": "second-slot", "workspace_id": ws_id},
        headers=headers,
    )
    assert second.status_code == 200, second.text

    summary = await client.get(f"/api/workspaces/{ws_id}/summary", headers=headers)
    assert summary.status_code == 200
    assert summary.json()["effective_tier"] == "free"
    assert summary.json()["project_count"] == 1
    assert summary.json()["project_limit"] == 1


@pytest.mark.asyncio
async def test_registration_requires_explicit_legal_consent_fields(client: AsyncClient):
    base_payload = {
        "email": "consent_test@example.com",
        "password": "ValidPassword123!",
    }

    # 1. Missing accept_terms -> 422
    p1 = dict(base_payload)
    p1["terms_version"] = "2026-08-31"
    p1["privacy_version"] = "2026-08-31"
    r1 = await client.post("/api/auth/register", json=p1)
    assert r1.status_code == 422

    # 2. Missing terms_version -> 422
    p2 = dict(base_payload)
    p2["accept_terms"] = True
    p2["privacy_version"] = "2026-08-31"
    r2 = await client.post("/api/auth/register", json=p2)
    assert r2.status_code == 422

    # 3. Missing privacy_version -> 422
    p3 = dict(base_payload)
    p3["accept_terms"] = True
    p3["terms_version"] = "2026-08-31"
    r3 = await client.post("/api/auth/register", json=p3)
    assert r3.status_code == 422

    # 4. accept_terms is False -> 422
    p4 = dict(base_payload)
    p4["accept_terms"] = False
    p4["terms_version"] = "2026-08-31"
    p4["privacy_version"] = "2026-08-31"
    r4 = await client.post("/api/auth/register", json=p4)
    assert r4.status_code == 422

    # 5. All valid -> 200
    p5 = dict(base_payload)
    p5["accept_terms"] = True
    p5["terms_version"] = "2026-08-31"
    p5["privacy_version"] = "2026-08-31"
    r5 = await client.post("/api/auth/register", json=p5)
    assert r5.status_code == 200


def test_telegram_entitlements_for_solo_and_studio():
    import crud
    assert crud.has_telegram_entitlement("solo") is True
    assert crud.has_telegram_entitlement("studio") is True
    assert crud.has_telegram_entitlement("business") is True
    assert crud.has_telegram_entitlement("pro") is True
    assert crud.has_telegram_entitlement("team") is True
    assert crud.has_telegram_entitlement("free") is False
    assert crud.has_telegram_entitlement("free", proj_slug="demo-showcase") is True
    assert crud.has_telegram_entitlement("free", proj_slug="regular-project") is False


@pytest.mark.asyncio
async def test_authoritative_server_request_id_cannot_be_spoofed(client: AsyncClient):
    spoofed = "client_injected_request_id_12345678"
    resp = await client.get("/health", headers={"X-Request-ID": spoofed})
    assert resp.status_code == 200

    server_req_id = resp.headers.get("X-Request-ID")
    assert server_req_id != spoofed, "Server must not adopt client-provided request ID as its authoritative request ID"
    assert len(server_req_id) == 32, "Server request ID must be 32-hex characters uuid4"
    assert resp.headers.get("X-Client-Correlation-ID") == spoofed


@pytest.mark.asyncio
async def test_runtime_error_bridge_ingest_dedup_reopen_and_rotation(client: AsyncClient, monkeypatch):
    # 1. Setup workspace & project
    headers = await register_login(client, "errors_pipeline@test.dev")
    ws_id = await workspace(client, headers)

    proj_res = await client.post(
        "/api/projects",
        json={"name": "Crash Testing App", "slug": "crash-app", "workspace_id": ws_id},
        headers=headers
    )
    assert proj_res.status_code == 200, proj_res.text
    proj_data = proj_res.json()
    ingest_key = proj_data["ingest_key"]
    public_key = proj_data["public_widget_key"]
    assert ingest_key.startswith("vb_ingest_")
    assert "raw_ingest_key" not in models.Project.__table__.columns

    # Secret is returned once by create/rotate, never by ordinary dashboard reads.
    project_list = await client.get(f"/api/workspaces/{ws_id}/projects", headers=headers)
    assert project_list.status_code == 200
    dashboard_project = next(item for item in project_list.json() if item["slug"] == "crash-app")
    assert "ingest_key" not in dashboard_project
    assert dashboard_project["ingest_key_configured"] is True
    assert dashboard_project["runtime_error_tracking_enabled"] is False

    disabled_by_default = await client.post(
        "/api/ingest/errors",
        headers={"X-VibeUs-Ingest-Key": ingest_key},
        json={"exception_type": "ValueError", "message": "opt-in required"},
    )
    assert disabled_by_default.status_code == 403
    enable_res = await client.patch(
        f"/api/workspaces/{ws_id}/projects/crash-app/settings",
        json={"runtime_error_tracking_enabled": True},
        headers=headers,
    )
    assert enable_res.status_code == 200
    assert enable_res.json()["runtime_error_tracking_enabled"] is True

    side_effect_calls = []
    async def capture_side_effects(*args, **kwargs):
        side_effect_calls.append((args, kwargs))
    import crud
    monkeypatch.setattr(crud, "ticket_created_post_commit_side_effects", capture_side_effects)

    broadcast_events = []
    async def capture_broadcast(message, project_id, *args, **kwargs):
        broadcast_events.append((message, project_id))
    monkeypatch.setattr(main.manager, "broadcast", capture_broadcast)

    # 2. Ingest without key -> 401
    bad_res = await client.post(
        "/api/ingest/errors",
        json={"exception_type": "ValueError", "message": "Missing key test"}
    )
    assert bad_res.status_code == 401

    # 3. Ingest with invalid key -> 401
    bad_key_res = await client.post(
        "/api/ingest/errors",
        headers={"X-VibeUs-Ingest-Key": "vb_ingest_invalid_0123456789abcdef"},
        json={"exception_type": "ValueError", "message": "Invalid key test"}
    )
    assert bad_key_res.status_code == 401

    # 4. Ingest first occurrence -> creates group and auto-ticket
    payload1 = {
        "service": "billing-api",
        "exception_type": "DatabaseTimeoutError",
        "message": "Connection to postgres://dbuser:supersecret@db.internal:5432 timed out after 30000ms for alice@example.com Authorization=Bearer abc.def.ghi",
        "route": "/api/v1/orders/12345/checkout",
        "method": "POST",
        "status_code": 500,
        "environment": "production",
        "release": "v1.2.3",
        "request_id": "req_prod_crash_111",
        "stack": [
            {"filename": "/home/alex/private/app/services/checkout.py", "lineno": 88, "function": "process_checkout", "code": "password = 'literal-secret'"}
        ]
    }
    ingest1 = await client.post(
        "/api/ingest/errors",
        headers={"X-VibeUs-Ingest-Key": ingest_key},
        json=payload1
    )
    assert ingest1.status_code == 200, ingest1.text
    data1 = ingest1.json()
    assert data1["success"] is True
    assert data1["occurrences_count"] == 1
    assert data1["is_regression"] is False
    assert data1["ticket_id"] is not None
    group_id = data1["group_id"]
    fingerprint = data1["fingerprint"]
    ticket_id = data1["ticket_id"]

    # Verify ticket in project board
    board_res = await client.get("/api/projects/crash-app/board", headers=headers)
    assert board_res.status_code == 200
    board = board_res.json()
    tickets = [t for node in board.get("nodes", []) for t in node.get("tickets", [])]
    crash_ticket = next((t for t in tickets if t["id"] == ticket_id), None)
    assert crash_ticket is not None
    assert crash_ticket["priority"] == "high"
    assert "DatabaseTimeoutError" in crash_ticket["title"]
    assert crash_ticket["bug_context"]["source"] == "runtime_error"
    assert crash_ticket["bug_context"]["occurrences"] == 1
    assert len(side_effect_calls) == 1, "Runtime auto-ticket must run shared post-commit integrations exactly once"
    assert any(event[0].get("type") == "board.refresh" for event in broadcast_events)

    serialized_board = json.dumps(board, ensure_ascii=False)
    assert "supersecret" not in serialized_board
    assert "alice@example.com" not in serialized_board
    assert "literal-secret" not in serialized_board
    async with TestingSessionLocal() as db:
        occurrence = (await db.execute(select(models.ErrorOccurrence))).scalars().one()
        group = (await db.execute(select(models.ErrorGroup))).scalars().one()
        assert occurrence.stack and "code" not in occurrence.stack[0]
        assert occurrence.stack[0]["filename"].endswith("app/services/checkout.py")
        persisted = json.dumps({"stack": occurrence.stack, "message": group.normalized_message}, ensure_ascii=False)
        assert "supersecret" not in persisted
        assert "alice@example.com" not in persisted

    # Correlated feedback must reuse the existing runtime ticket, not create a duplicate.
    feedback_res = await client.post(
        "/api/projects/crash-app/feedback",
        headers={"X-Vibus-Public-Key": public_key},
        json={"text": "Checkout fails after click", "category": "bug", "request_id": "req_prod_crash_111"},
    )
    assert feedback_res.status_code == 200, feedback_res.text
    feedback_id = feedback_res.json()["feedback_id"]
    node_id = board["nodes"][0]["id"]
    converted = await client.post(
        f"/api/projects/crash-app/feedback/{feedback_id}/convert-to-ticket",
        headers=headers,
        json={"node_id": node_id, "title": "User saw checkout crash", "priority": "high", "summary": "Correlated"},
    )
    assert converted.status_code == 200, converted.text
    assert converted.json()["ticket"]["id"] == ticket_id
    after_feedback_board = (await client.get("/api/projects/crash-app/board", headers=headers)).json()
    after_feedback_tickets = [t for node in after_feedback_board.get("nodes", []) for t in node.get("tickets", [])]
    assert len(after_feedback_tickets) == 1, "Feedback correlation must not duplicate the Runtime Bridge ticket"
    assert any("Feedback" in c.get("text", "") for c in after_feedback_tickets[0].get("comments", []))

    # 5. Ingest second occurrence with normalized route (/orders/67890/checkout) -> groups under SAME group
    payload2 = {
        "service": "billing-api",
        "exception_type": "DatabaseTimeoutError",
        "message": "Connection to postgres://dbuser:supersecret@db.internal:5432 timed out after 30000ms for alice@example.com Authorization=Bearer abc.def.ghi",
        "route": "/api/v1/orders/67890/checkout", # different order ID, should normalize to /:id
        "method": "POST",
        "status_code": 500,
        "environment": "production",
        "release": "v1.2.3",
        "request_id": "req_prod_crash_222",
        "stack": [
            {"filename": "/home/alex/private/app/services/checkout.py", "lineno": 88, "function": "process_checkout", "code": "password = 'literal-secret'"}
        ]
    }
    ingest2 = await client.post(
        "/api/ingest/errors",
        headers={"X-VibeUs-Ingest-Key": ingest_key},
        json=payload2
    )
    assert ingest2.status_code == 200
    data2 = ingest2.json()
    assert data2["group_id"] == group_id
    assert data2["fingerprint"] == fingerprint
    assert data2["occurrences_count"] == 2
    assert data2["is_regression"] is False

    # 6. Close the ticket (Done)
    close_res = await client.put(
        f"/api/projects/crash-app/tickets/{ticket_id}",
        json={"status": "done"},
        headers=headers
    )
    assert close_res.status_code == 200, close_res.text
    assert close_res.json()["status"] == "done"

    # 7. Ingest third occurrence -> REGRESSION! Must reopen ticket
    ingest3 = await client.post(
        "/api/ingest/errors",
        headers={"X-VibeUs-Ingest-Key": ingest_key},
        json=payload2
    )
    assert ingest3.status_code == 200
    data3 = ingest3.json()
    assert data3["group_id"] == group_id
    assert data3["occurrences_count"] == 3
    assert data3["is_regression"] is True

    # Verify ticket was reopened to in_progress with regression comment
    board3 = await client.get("/api/projects/crash-app/board", headers=headers)
    assert board3.status_code == 200
    all_tickets = [t for node in board3.json().get("nodes", []) for t in node.get("tickets", [])]
    reopened_ticket = next(t for t in all_tickets if t["id"] == ticket_id)
    assert reopened_ticket["status"] == "in_progress"
    assert any("Регрессия" in c.get("text", "") for c in reopened_ticket.get("comments", []))

    # 8. Rotate ingest key
    rot_res = await client.post(
        f"/api/workspaces/{ws_id}/projects/crash-app/rotate-ingest-key",
        headers=headers
    )
    assert rot_res.status_code == 200
    new_ingest_key = rot_res.json()["ingest_key"]
    assert new_ingest_key != ingest_key
    project_list_after_rotate = await client.get(f"/api/workspaces/{ws_id}/projects", headers=headers)
    assert new_ingest_key not in project_list_after_rotate.text
    assert "\"ingest_key\"" not in project_list_after_rotate.text

    # Old key fails with 401
    old_fail = await client.post(
        "/api/ingest/errors",
        headers={"X-VibeUs-Ingest-Key": ingest_key},
        json=payload1
    )
    assert old_fail.status_code == 401

    # New key succeeds
    new_ok = await client.post(
        "/api/ingest/errors",
        headers={"X-VibeUs-Ingest-Key": new_ingest_key},
        json=payload1
    )
    assert new_ok.status_code == 200
    assert new_ok.json()["occurrences_count"] == 4

    # 9. Test project settings toggle (disable runtime error tracking)
    disable_res = await client.patch(
        f"/api/workspaces/{ws_id}/projects/crash-app/settings",
        json={"runtime_error_tracking_enabled": False},
        headers=headers
    )
    assert disable_res.status_code == 200
    assert disable_res.json()["runtime_error_tracking_enabled"] is False

    blocked_ingest = await client.post(
        "/api/ingest/errors",
        headers={"X-VibeUs-Ingest-Key": new_ingest_key},
        json=payload1
    )
    assert blocked_ingest.status_code == 403

    # 10. List project errors endpoint
    errors_list = await client.get(
        f"/api/workspaces/{ws_id}/projects/crash-app/errors",
        headers=headers
    )
    assert errors_list.status_code == 200
    err_items = errors_list.json()
    assert len(err_items) == 1
    assert err_items[0]["id"] == group_id
    assert err_items[0]["occurrences_count"] == 4


def test_vibeus_middleware_sdk():
    from vibeus_sdk import VibeUsMiddleware
    from fastapi import FastAPI
    import error_bridge

    test_app = FastAPI()
    test_app.add_middleware(
        VibeUsMiddleware,
        ingest_key="vb_ingest_test",
        server_url="http://localhost:8000"
    )

    # Check fingerprint algorithm determinism & normalization
    fp1 = error_bridge.compute_fingerprint("backend", "ValueError", "/api/items/123", "items.py:10 foo()", "Item 123 failed with id 456")
    fp2 = error_bridge.compute_fingerprint("backend", "ValueError", "/api/items/999", "items.py:10 foo()", "Item 999 failed with id 888")
    assert fp1 == fp2, "Fingerprints must be identical after route and message normalization"

    import vibeus_sdk
    sdk_safe = vibeus_sdk._redact_runtime_text(
        "postgres://user:supersecret@db.local/x alice@example.com Authorization=Bearer aaa.bbb.ccc vb_ingest_deadbeefdeadbeef"
    )
    assert "supersecret" not in sdk_safe
    assert "alice@example.com" not in sdk_safe
    assert "aaa.bbb.ccc" not in sdk_safe
    assert "vb_ingest_deadbeefdeadbeef" not in sdk_safe
    assert vibeus_sdk._safe_filename("/home/alex/private/app/services/orders.py") == "app/services/orders.py"


@pytest.mark.asyncio
async def test_project_delete_revokes_all_credentials_and_sessions(client: AsyncClient):
    headers = await register_login(client, "delete-hardening@test.dev")
    ws_id = await workspace(client, headers)
    created = await client.post(
        "/api/projects",
        json={"name": "Delete Me", "slug": "delete-me", "workspace_id": ws_id},
        headers=headers,
    )
    assert created.status_code == 200, created.text
    project_id = created.json()["id"]

    async with TestingSessionLocal() as db:
        project = (await db.execute(select(models.Project).where(models.Project.id == project_id))).scalar_one()
        project.github_token = "ghp_example_secret_for_delete_test"
        project.github_sync_enabled = True
        link = models.ProjectAccessLink(
            project_id=project_id,
            token_hash=security.hash_access_token("vibus-access-delete-test"),
            label="delete test",
        )
        tunnel = models.TunnelSession(
            tunnel_id="tun_delete_test",
            project_id=project_id,
            connect_token_digest=security.hash_access_token("tunnel-delete-secret"),
            expires_at=models.utcnow() + timedelta(hours=1),
        )
        db.add_all([link, tunnel])
        await db.flush()
        preview = models.PreviewSession(
            session_digest=security.hash_access_token("preview-delete-secret"),
            tunnel_id=tunnel.tunnel_id,
            access_link_id=link.id,
            expires_at=models.utcnow() + timedelta(hours=1),
        )
        db.add(preview)
        await db.commit()

    deleted = await client.delete(
        f"/api/workspaces/{ws_id}/projects/delete-me?confirmation_slug=delete-me",
        headers=headers,
    )
    assert deleted.status_code == 200, deleted.text

    async with TestingSessionLocal() as db:
        project = (await db.execute(select(models.Project).where(models.Project.id == project_id))).scalar_one()
        assert project.is_deleted is True
        assert project.api_token_digest is None
        assert project.public_widget_key is None
        assert project.public_widget_key_digest is None
        assert project.ingest_key_digest is None
        assert project.github_token_encrypted is None
        assert project.github_sync_enabled is False
        assert project.runtime_error_tracking_enabled is False
        assert project.telemetry_enabled is False
        assert project.ai_data_sharing is False

        link = (await db.execute(select(models.ProjectAccessLink).where(models.ProjectAccessLink.project_id == project_id))).scalar_one()
        assert link.token_hash.startswith("revoked_")
        assert link.expires_at is not None
        assert link.activated_fingerprint is None

        tunnel = (await db.execute(select(models.TunnelSession).where(models.TunnelSession.project_id == project_id))).scalar_one()
        assert tunnel.status == "revoked"
        assert tunnel.is_connected is False
        assert tunnel.connect_token_digest.startswith("revoked_")

        preview = (await db.execute(select(models.PreviewSession).where(models.PreviewSession.tunnel_id == tunnel.tunnel_id))).scalar_one()
        assert preview.revoked_at is not None


@pytest.mark.asyncio
async def test_runtime_error_dashboard_details_status_update_and_test_event(client: AsyncClient, monkeypatch):
    headers = await register_login(client, "errors_ux@test.dev")
    ws_id = await workspace(client, headers)
    created = await client.post(
        "/api/projects",
        json={"name": "UX Errors App", "slug": "ux-errors-app", "workspace_id": ws_id},
        headers=headers,
    )
    assert created.status_code == 200, created.text

    # Mock background broadcast/side-effects
    side_effect_calls = []
    async def capture_side_effects(*args, **kwargs):
        side_effect_calls.append((args, kwargs))
    import crud
    monkeypatch.setattr(crud, "ticket_created_post_commit_side_effects", capture_side_effects)

    broadcast_events = []
    async def capture_broadcast(message, project_id, *args, **kwargs):
        broadcast_events.append((message, project_id))
    monkeypatch.setattr(main.manager, "broadcast", capture_broadcast)

    # 1. Test event fails when tracking is disabled
    disabled_res = await client.post(
        f"/api/workspaces/{ws_id}/projects/ux-errors-app/errors/test-event",
        headers=headers,
    )
    assert disabled_res.status_code == 403

    # 2. Enable runtime tracking
    enable_res = await client.patch(
        f"/api/workspaces/{ws_id}/projects/ux-errors-app/settings",
        json={"runtime_error_tracking_enabled": True},
        headers=headers,
    )
    assert enable_res.status_code == 200
    assert enable_res.json()["runtime_error_tracking_enabled"] is True

    # 3. Trigger synthetic test event
    test_evt_res = await client.post(
        f"/api/workspaces/{ws_id}/projects/ux-errors-app/errors/test-event",
        headers=headers,
    )
    assert test_evt_res.status_code == 200, test_evt_res.text
    test_evt_data = test_evt_res.json()
    assert test_evt_data["success"] is True
    group_id = test_evt_data["group_id"]
    assert group_id is not None
    assert test_evt_data["ticket_key"] is not None

    # 4. Fetch error detail
    detail_res = await client.get(
        f"/api/workspaces/{ws_id}/projects/ux-errors-app/errors/{group_id}",
        headers=headers,
    )
    assert detail_res.status_code == 200, detail_res.text
    detail_data = detail_res.json()
    assert detail_data["exception_type"] == "ZeroDivisionError"
    assert detail_data["status"] == "open"
    assert detail_data["ticket_key"] == test_evt_data["ticket_key"]
    assert detail_data["latest_occurrence"] is not None
    assert len(detail_data["latest_occurrence"]["stack"]) == 2

    # 5. Update error status to ignored
    ignore_res = await client.patch(
        f"/api/workspaces/{ws_id}/projects/ux-errors-app/errors/{group_id}",
        json={"status": "ignored"},
        headers=headers,
    )
    assert ignore_res.status_code == 200
    assert ignore_res.json()["status"] == "ignored"

    # 6. Update error status to resolved
    resolve_res = await client.patch(
        f"/api/workspaces/{ws_id}/projects/ux-errors-app/errors/{group_id}",
        json={"status": "resolved"},
        headers=headers,
    )
    assert resolve_res.status_code == 200
    assert resolve_res.json()["status"] == "resolved"


@pytest.mark.asyncio
async def test_public_pricing_is_runtime_catalog_not_frontend_constant(client: AsyncClient):
    from decimal import Decimal
    from settings import get_settings

    response = await client.get('/api/public/pricing')
    assert response.status_code == 200, response.text
    data = response.json()
    settings = get_settings()

    assert data['period_days'] == settings.billing_period_days
    assert data['default_market'] == settings.pricing_default_market
    assert data['markets']['ru']['currency'] == 'RUB'
    assert data['markets']['global']['currency'] == 'USD'
    assert Decimal(data['markets']['ru']['plans']['solo']['amount']) == settings.price_rub_solo
    assert Decimal(data['markets']['ru']['plans']['studio']['amount']) == settings.price_rub_studio
    assert Decimal(data['markets']['global']['plans']['solo']['amount']) == settings.price_usd_solo
    assert Decimal(data['markets']['global']['plans']['studio']['amount']) == settings.price_usd_studio
    assert data['markets']['ru']['plans']['solo']['project_limit'] == 10
    assert data['markets']['ru']['plans']['studio']['project_limit'] == 50


@pytest.mark.asyncio
async def test_founder_promo_grants_only_timed_access_and_is_one_per_workspace(client: AsyncClient):
    headers = await register_login(client, 'founding-promo@test.dev')
    ws_id = await workspace(client, headers)
    raw_code = 'FOUNDING-STUDIO30-TEST'

    async with TestingSessionLocal() as db:
        db.add(models.PromoCode(
            code_digest=security.hash_access_token(raw_code),
            tier='studio',
            duration_days=30,
            grants_lifetime=False,
            campaign='founding_sep26',
            max_uses=50,
            times_used=0,
            is_active=True,
        ))
        await db.commit()

    before = models.utcnow()
    response = await client.post(
        f'/api/workspaces/{ws_id}/redeem-promo',
        json={'code': raw_code},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['subscription_tier'] == 'studio'
    assert body['subscription_status'] == 'active'
    assert body['is_lifetime_free'] is False
    assert body['promo_campaign'] == 'founding_sep26'
    assert body['promo_duration_days'] == 30
    assert body['current_period_end'] is not None

    async with TestingSessionLocal() as db:
        ws = (await db.execute(select(models.Workspace).where(models.Workspace.id == ws_id))).scalar_one()
        assert ws.is_lifetime_free is False
        assert ws.current_period_end >= before + timedelta(days=29)
        assert ws.current_period_end <= before + timedelta(days=31)
        redemptions = (await db.execute(
            select(models.PromoRedemption).where(models.PromoRedemption.workspace_id == ws_id)
        )).scalars().all()
        assert len(redemptions) == 1
        assert redemptions[0].campaign == 'founding_sep26'
        assert redemptions[0].duration_days == 30

    duplicate = await client.post(
        f'/api/workspaces/{ws_id}/redeem-promo',
        json={'code': raw_code},
        headers=headers,
    )
    assert duplicate.status_code == 409

    second_ws = await client.post('/api/workspaces', json={'name': 'Second Founding Workspace'}, headers=headers)
    assert second_ws.status_code == 200
    second_user_reuse = await client.post(
        f"/api/workspaces/{second_ws.json()['id']}/redeem-promo",
        json={'code': raw_code},
        headers=headers,
    )
    assert second_user_reuse.status_code == 409


@pytest.mark.asyncio
async def test_lower_tier_promo_cannot_extend_active_higher_tier(client: AsyncClient):
    headers = await register_login(client, 'promo-downgrade@test.dev')
    ws_id = await workspace(client, headers)
    raw_code = 'FOUNDING-SOLO30-DOWNGRADE'

    async with TestingSessionLocal() as db:
        ws = (await db.execute(select(models.Workspace).where(models.Workspace.id == ws_id))).scalar_one()
        ws.subscription_tier = 'studio'
        ws.subscription_status = 'active'
        ws.current_period_end = models.utcnow() + timedelta(days=20)
        db.add(models.PromoCode(
            code_digest=security.hash_access_token(raw_code),
            tier='solo', duration_days=30, grants_lifetime=False,
            campaign='founding_sep26', max_uses=5, times_used=0, is_active=True,
        ))
        await db.commit()

    response = await client.post(
        f'/api/workspaces/{ws_id}/redeem-promo',
        json={'code': raw_code},
        headers=headers,
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_workspace_records_and_persists_first_touch_attribution(client: AsyncClient):
    headers = await register_login(client, 'attribution@test.dev')
    res = await client.post(
        '/api/workspaces',
        json={'name': 'ProductRadar Cohort', 'first_touch_source': 'productradar'},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data['first_touch_source'] == 'productradar'
    assert data['first_touch_at'] is not None

    ws_id = data['id']
    async with TestingSessionLocal() as db:
        ws = (await db.execute(select(models.Workspace).where(models.Workspace.id == ws_id))).scalar_one()
        assert ws.first_touch_source == 'productradar'
        assert ws.first_touch_at is not None

        # Verify audit trail
        audit = (await db.execute(
            select(models.AuditEvent).where(
                models.AuditEvent.workspace_id == ws_id,
                models.AuditEvent.event_type == 'workspace.created',
            )
        )).scalar_one()
        assert audit.details.get('first_touch_source') == 'productradar'


def test_production_packaging_and_docker_contracts():
    from pathlib import Path

    repo_root = Path(__file__).resolve().parent.parent

    # 1. Exact Dockerfile casing
    dockerfile = repo_root / 'openspec-core' / 'Dockerfile'
    assert dockerfile.exists(), 'openspec-core/Dockerfile must exist'
    assert dockerfile.is_file()

    # 2. Production compose config check
    compose_path = repo_root / 'docker-compose.prod.yml'
    assert compose_path.exists()
    content = compose_path.read_text(encoding='utf-8')
    assert 'dockerfile: Dockerfile' in content
    assert 'command: uvicorn' not in content, 'Production compose must not duplicate uvicorn command'

    # 3. Entrypoint checks
    entrypoint = repo_root / 'openspec-core' / 'entrypoint.sh'
    assert entrypoint.exists()
    entrypoint_content = entrypoint.read_text(encoding='utf-8')
    assert '--proxy-headers' in entrypoint_content
    assert '--forwarded-allow-ips "*"' in entrypoint_content


def test_production_settings_npd_mode_does_not_require_54fz_vat_and_subject():
    from settings import Settings
    from pydantic import SecretStr

    # 1. In NPD mode, production validation passes without 54-FZ KKT VAT/subject codes
    prod_npd = Settings(
        environment="production",
        database_url="postgresql+asyncpg://user:pass@db:5432/vibeus",
        public_base_url="https://vibeus.pro",
        preview_base_url="https://preview.vibeus-preview.net",
        cors_origins=["https://vibeus.pro"],
        token_pepper=SecretStr("a" * 32),
        field_encryption_key=SecretStr("b" * 32),
        enable_mock_billing=False,
        enable_demo_seed=False,
        enable_yookassa=True,
        yookassa_shop_id=SecretStr("123456"),
        yookassa_secret_key=SecretStr("secret_key_123456"),
        billing_tax_mode="npd",
        yookassa_vat_code="",
        yookassa_payment_subject="",
    )
    assert prod_npd.billing_tax_mode == "npd"

    # 2. In 54-FZ KKT mode, production validation strictly requires VAT code and payment subject
    with pytest.raises(ValueError, match="YOOKASSA_VAT_CODE"):
        Settings(
            environment="production",
            database_url="postgresql+asyncpg://user:pass@db:5432/vibeus",
            public_base_url="https://vibeus.pro",
            preview_base_url="https://preview.vibeus-preview.net",
            cors_origins=["https://vibeus.pro"],
            token_pepper=SecretStr("a" * 32),
            field_encryption_key=SecretStr("b" * 32),
            enable_mock_billing=False,
            enable_demo_seed=False,
            enable_yookassa=True,
            yookassa_shop_id=SecretStr("123456"),
            yookassa_secret_key=SecretStr("secret_key_123456"),
            billing_tax_mode="kkt_54fz",
            yookassa_vat_code="",
            yookassa_payment_subject="",
        )


@pytest.mark.asyncio
async def test_npd_payment_fiscal_state_is_server_owned_and_tax_mode_is_snapshotted(
    client: AsyncClient, monkeypatch
):
    headers = await register_login(client, 'npd-payer@test.dev')
    ws_id = await workspace(client, headers)

    async with TestingSessionLocal() as db:
        payment = models.Payment(
            provider="yookassa",
            provider_payment_id="yk_npd_test_12345",
            workspace_id=ws_id,
            plan="solo",
            amount_minor=149000,
            currency="RUB",
            status="pending",
            tax_mode="npd",
            fiscal_status="receipt_not_required",
            is_test=False,
        )
        db.add(payment)
        await db.commit()
        payment_id = payment.id

    # Pending money must not create a receipt obligation yet.
    list_res = await client.get(f"/api/workspaces/{ws_id}/payments", headers=headers)
    assert list_res.status_code == 200, list_res.text
    item = list_res.json()[0]
    assert item["status"] == "pending"
    assert item["tax_mode"] == "npd"
    assert item["fiscal_status"] == "receipt_not_required"

    # A buyer/workspace owner must never be able to mutate the seller's fiscal ledger.
    receipt_res = await client.post(
        f"/api/workspaces/{ws_id}/payments/{payment_id}/receipt",
        json={"receipt_url": "https://lknpd.nalog.ru/api/v1/receipt/213005986909/12345/print"},
        headers=headers,
    )
    assert receipt_res.status_code in {404, 405}

    # Simulate a deployment config switch after checkout creation. The payment's
    # snapshotted tax_mode, not current config, must decide the fiscal transition.
    monkeypatch.setattr(yookassa_service, "YOOKASSA_SHOP_ID", "")
    monkeypatch.setattr(yookassa_service, "YOOKASSA_SECRET_KEY", "")
    monkeypatch.setattr(
        yookassa_service,
        "get_settings",
        lambda: SimpleNamespace(
            billing_tax_mode="kkt_54fz",
            billing_period_days=30,
            enable_mock_billing=False,
        ),
    )
    async with TestingSessionLocal() as db:
        result = await yookassa_service.process_yookassa_webhook(
            {
                "event": "payment.succeeded",
                "object": {
                    "id": "yk_npd_test_12345",
                    "status": "succeeded",
                    "test": False,
                    "amount": {"value": "1490.00", "currency": "RUB"},
                    "payment_method": {},
                },
            },
            db,
        )
        assert result["status"] == "ok"
        updated = (await db.execute(
            select(models.Payment).where(models.Payment.id == payment_id)
        )).scalar_one()
        assert updated.status == "succeeded"
        assert updated.tax_mode == "npd"
        assert updated.fiscal_status == "receipt_required"

        official = "https://lknpd.nalog.ru/api/v1/receipt/213005986909/12345/print"
        issued = await manage_receipts.mark_receipt_issued(db, payment_id, official)
        assert issued.fiscal_status == "receipt_issued"
        assert issued.receipt_url == official
        assert issued.receipt_issued_at is not None

    assert manage_receipts.validate_receipt_url(
        "https://lknpd.nalog.ru/api/v1/receipt/213005986909/12345/print"
    )
    with pytest.raises(ValueError):
        manage_receipts.validate_receipt_url("http://lknpd.nalog.ru/api/v1/receipt/x")
    with pytest.raises(ValueError):
        manage_receipts.validate_receipt_url("https://example.com/fake-receipt")


@pytest.mark.asyncio
async def test_operator_receipt_cli_rejects_non_succeeded_or_non_npd_payments(client: AsyncClient):
    headers = await register_login(client, 'npd-reject@test.dev')
    ws_id = await workspace(client, headers)
    official = "https://lknpd.nalog.ru/api/v1/receipt/213005986909/12345/print"

    async with TestingSessionLocal() as db:
        pending = models.Payment(
            provider="yookassa", provider_payment_id="pending_receipt", workspace_id=ws_id,
            plan="solo", amount_minor=149000, currency="RUB", status="pending",
            tax_mode="npd", fiscal_status="receipt_not_required", is_test=False,
        )
        kkt = models.Payment(
            provider="yookassa", provider_payment_id="kkt_receipt", workspace_id=ws_id,
            plan="solo", amount_minor=149000, currency="RUB", status="succeeded",
            tax_mode="kkt_54fz", fiscal_status="receipt_not_required", is_test=False,
        )
        db.add_all([pending, kkt])
        await db.commit()
        with pytest.raises(ValueError, match="succeeded"):
            await manage_receipts.mark_receipt_issued(db, pending.id, official)
        with pytest.raises(ValueError, match="tax_mode=npd"):
            await manage_receipts.mark_receipt_issued(db, kkt.id, official)

