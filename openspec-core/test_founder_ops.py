import types

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

import control_router
import main
from database import get_db
from main import app
from models import Base


SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def override_get_db():
    async with TestingSessionLocal() as session:
        yield session


def control_settings():
    return types.SimpleNamespace(
        enable_control_center=True,
        platform_admin_emails=["founder@vibeus.test"],
        control_elevation_minutes=15,
        token_pepper=SecretStr("x" * 64),
        environment="test",
        public_base_url="https://vibeus.test",
        global_billing_provider="cloudpayments",
        enable_global_pricing=False,
        enable_mock_billing=False,
        enable_yookassa=False,
        enable_cloudpayments=False,
        enable_stripe=False,
        enable_lava=False,
    )


@pytest_asyncio.fixture(autouse=True)
async def prepare_database(monkeypatch):
    orig_session = main.async_session
    orig_engine = main.engine
    main.async_session = TestingSessionLocal
    main.engine = engine
    main.limiter.enabled = False
    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(control_router, "get_settings", control_settings)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides[get_db] = override_get_db
    main.async_session = orig_session
    main.engine = orig_engine
    main.limiter.enabled = True


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as async_client:
        yield async_client


async def register_and_login(client: AsyncClient, email: str):
    password = "Correct-Horse-42!Battery"
    registered = await client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": password,
            "accept_terms": True,
            "terms_version": "test-v1",
            "privacy_version": "test-v1",
        },
    )
    assert registered.status_code == 200, registered.text
    login = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    return {
        "headers": {"Authorization": f"Bearer {login.json()['access_token']}"},
        "password": password,
        "user": registered.json(),
    }


async def elevate(client: AsyncClient, identity: dict):
    response = await client.post(
        "/api/control/elevate",
        headers=identity["headers"],
        json={"password": identity["password"]},
    )
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_launch_checklist_is_private_persistent_and_step_up_guarded(client: AsyncClient):
    admin = await register_and_login(client, "founder@vibeus.test")
    regular = await register_and_login(client, "regular@vibeus.test")

    denied = await client.get("/api/control/launch-checklist", headers=regular["headers"])
    assert denied.status_code == 403

    initial = await client.get("/api/control/launch-checklist", headers=admin["headers"])
    assert initial.status_code == 200, initial.text
    assert initial.json()["total"] >= 12
    key = initial.json()["items"][0]["key"]
    assert initial.json()["items"][0]["status"] == "todo"

    locked = await client.patch(
        f"/api/control/launch-checklist/{key}",
        headers=admin["headers"],
        json={"status": "published", "link": "https://example.test/post", "notes": "first launch"},
    )
    assert locked.status_code == 403

    await elevate(client, admin)
    saved = await client.patch(
        f"/api/control/launch-checklist/{key}",
        headers=admin["headers"],
        json={"status": "published", "link": "https://example.test/post", "notes": "first launch"},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["published_at"]

    reread = await client.get("/api/control/launch-checklist", headers=admin["headers"])
    item = next(item for item in reread.json()["items"] if item["key"] == key)
    assert item["status"] == "published"
    assert item["link"] == "https://example.test/post"


@pytest.mark.asyncio
async def test_live_markdown_brief_uses_radar_and_excludes_customer_content(client: AsyncClient):
    admin = await register_and_login(client, "founder@vibeus.test")
    customer = await register_and_login(client, "customer-private@vibeus.test")

    workspace = await client.post("/api/workspaces", headers=customer["headers"], json={"name": "Private Workspace"})
    assert workspace.status_code == 200, workspace.text

    brief = await client.get("/api/control/briefing.md", headers=admin["headers"])
    assert brief.status_code == 200, brief.text
    assert brief.headers["cache-control"].startswith("no-store")
    assert "VibeUs Founder AI Brief" in brief.text
    assert "Steering radar" in brief.text
    assert "Launch distribution checklist" in brief.text
    assert "Money / ledger reconciliation" in brief.text
    assert "customer-private@vibeus.test" not in brief.text
    assert "Private Workspace" not in brief.text

    alias = await client.get("/api/control/radar.md", headers=admin["headers"])
    assert alias.status_code == 200
    assert "North Star" in alias.text

    structured = await client.get("/api/control/briefing.json", headers=admin["headers"])
    assert structured.status_code == 200
    assert structured.json()["privacy"]["pii_included"] is False
    assert "dimensions" in structured.json()["radar"]


@pytest.mark.asyncio
async def test_founder_workbench_promotes_safe_post_mvp_capabilities_without_impersonation(client: AsyncClient):
    admin = await register_and_login(client, "founder@vibeus.test")
    customer = await register_and_login(client, "customer@vibeus.test")
    workspace = await client.post("/api/workspaces", headers=customer["headers"], json={"name": "Customer Workspace"})
    assert workspace.status_code == 200, workspace.text
    workspace_id = workspace.json()["id"]

    await elevate(client, admin)

    note = await client.post(
        f"/api/control/founder/customers/{customer['user']['id']}/support",
        headers=admin["headers"],
        json={"note": "Asked how to reach first value", "tags": ["onboarding", "activation"]},
    )
    assert note.status_code == 200, note.text

    privacy = await client.post(
        "/api/control/founder/privacy-requests",
        headers=admin["headers"],
        json={"user_id": customer["user"]["id"], "request_type": "export", "reason": "test request"},
    )
    assert privacy.status_code == 200, privacy.text

    flag = await client.post(
        "/api/control/founder/feature-flags",
        headers=admin["headers"],
        json={"key": "new_feedback_flow", "description": "beta flow", "enabled": True, "rollout_pct": 100, "workspace_ids": [workspace_id]},
    )
    assert flag.status_code == 200, flag.text

    evaluated = await client.get(f"/api/feature-flags?workspace_id={workspace_id}", headers=customer["headers"])
    assert evaluated.status_code == 200, evaluated.text
    assert evaluated.json()["flags"]["new_feedback_flow"] is True

    announcement = await client.post(
        "/api/control/founder/announcements",
        headers=admin["headers"],
        json={"title": "Founder test", "body": "Visible to this workspace", "active": True, "workspace_ids": [workspace_id], "tiers": []},
    )
    assert announcement.status_code == 200, announcement.text
    visible = await client.get(f"/api/announcements?workspace_id={workspace_id}", headers=customer["headers"])
    assert visible.status_code == 200, visible.text
    assert [item["title"] for item in visible.json()["announcements"]] == ["Founder test"]

    diagnostic = await client.get(
        f"/api/control/founder/diagnostic/customers/{customer['user']['id']}",
        headers=admin["headers"],
    )
    assert diagnostic.status_code == 200, diagnostic.text
    assert diagnostic.json()["impersonation"] is False
    assert diagnostic.json()["session_minted"] is False
    assert "api_token" not in str(diagnostic.json()).lower()
    assert "ingest_key" not in str(diagnostic.json()).lower()

    capabilities = await client.get("/api/control/founder/capabilities", headers=admin["headers"])
    assert capabilities.status_code == 200
    by_key = {item["key"]: item for item in capabilities.json()["capabilities"]}
    assert by_key["customer_360"]["status"] == "implemented"
    assert by_key["feature_flags"]["status"] == "implemented"
    assert by_key["platform_admin_mfa"]["status"].startswith("blocked")
    assert by_key["provider_refund_cancel"]["status"].startswith("blocked")


@pytest.mark.asyncio
async def test_legacy_roadmap_only_lists_real_external_or_security_dependencies(client: AsyncClient):
    admin = await register_and_login(client, "founder@vibeus.test")
    response = await client.get("/api/control/roadmap", headers=admin["headers"])
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["phase"] == "post-mvp"
    assert len(payload["items"]) == 2
    titles = {item["title"] for item in payload["items"]}
    assert titles == {
        "Platform-admin passkey / MFA",
        "Provider-side refund and recurring cancellation adapters",
    }
