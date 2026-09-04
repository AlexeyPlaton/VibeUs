import types

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

import control_router
import entitlements
import main
import models
import security
from database import get_db
from main import app
from models import Base


SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
)
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
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client


async def register_and_login(client: AsyncClient, email: str) -> dict:
    password = "Correct-Horse-42!Battery"
    register = await client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": password,
            "accept_terms": True,
            "terms_version": "test-v1",
            "privacy_version": "test-v1",
        },
    )
    assert register.status_code == 200, register.text
    login = await client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert login.status_code == 200, login.text
    return {
        "headers": {"Authorization": f"Bearer {login.json()['access_token']}"},
        "password": password,
        "token": login.json()["access_token"],
        "user": register.json(),
    }


async def elevate(client: AsyncClient, identity: dict):
    response = await client.post(
        "/api/control/elevate",
        headers=identity["headers"],
        json={"password": identity["password"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["elevated"] is True


@pytest.mark.asyncio
async def test_control_is_platform_admin_only_and_sensitive_actions_require_step_up(client: AsyncClient):
    admin = await register_and_login(client, "founder@vibeus.test")
    regular = await register_and_login(client, "regular@vibeus.test")

    denied = await client.get("/api/control/me", headers=regular["headers"])
    assert denied.status_code == 403

    me = await client.get("/api/control/me", headers=admin["headers"])
    assert me.status_code == 200
    assert me.json()["platform_admin"] is True
    assert me.json()["elevated"] is False

    locked = await client.post(
        "/api/control/promos",
        headers=admin["headers"],
        json={"tier": "solo", "duration_days": 30, "campaign": "locked", "max_uses": 1},
    )
    assert locked.status_code == 403
    assert "re-authentication" in locked.json()["detail"]

    bad_password = await client.post(
        "/api/control/elevate",
        headers=admin["headers"],
        json={"password": "wrong-password"},
    )
    assert bad_password.status_code == 401

    await elevate(client, admin)

    created = await client.post(
        "/api/control/promos",
        headers=admin["headers"],
        json={
            "code": "LAUNCH-SOLO30",
            "tier": "solo",
            "duration_days": 30,
            "campaign": "launch",
            "max_uses": 50,
        },
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["plaintext_code"] == "LAUNCH-SOLO30"
    assert body["plaintext_visible_once"] is True
    assert "promo=LAUNCH-SOLO30" in body["share_url"]

    async with TestingSessionLocal() as db:
        promo = (await db.execute(select(models.PromoCode))).scalar_one()
        assert promo.code_digest == security.hash_access_token("LAUNCH-SOLO30")
        assert promo.code_digest != "LAUNCH-SOLO30"

    listed = await client.get("/api/control/promos", headers=admin["headers"])
    assert listed.status_code == 200
    serialized = str(listed.json())
    assert "LAUNCH-SOLO30" not in serialized
    assert listed.json()["promos"][0]["code_visible"] is False


@pytest.mark.asyncio
async def test_manual_grant_uses_domain_entitlement_and_preserves_payment_provenance(client: AsyncClient):
    admin = await register_and_login(client, "founder@vibeus.test")
    customer = await register_and_login(client, "customer@vibeus.test")
    await elevate(client, admin)

    workspace_response = await client.post(
        "/api/workspaces",
        headers=customer["headers"],
        json={"name": "Customer Workspace"},
    )
    assert workspace_response.status_code == 200, workspace_response.text
    workspace_id = workspace_response.json()["id"]

    granted = await client.post(
        f"/api/control/workspaces/{workspace_id}/grant-access",
        headers=admin["headers"],
        json={
            "tier": "solo",
            "duration_days": 45,
            "reason": "Compensation after onboarding support incident",
        },
    )
    assert granted.status_code == 200, granted.text
    assert granted.json()["effective_tier"] == "solo"

    async with TestingSessionLocal() as db:
        workspace = (
            await db.execute(select(models.Workspace).where(models.Workspace.id == workspace_id))
        ).scalar_one()
        assert entitlements.effective_tier(workspace) == "solo"
        assert workspace.billing_provider == "free"

        promo = (
            await db.execute(
                select(models.PromoCode).where(models.PromoCode.campaign == control_router.ADMIN_GRANT_CAMPAIGN)
            )
        ).scalar_one()
        assert promo.max_uses == 1
        assert promo.times_used == 1

        event = (
            await db.execute(
                select(models.AuditEvent).where(models.AuditEvent.event_type == "admin.entitlement.granted")
            )
        ).scalar_one()
        assert event.user_id == admin["user"]["id"]
        assert event.details["duration_days"] == 45
        assert "reason" in event.details


@pytest.mark.asyncio
async def test_user_block_revokes_sessions_and_self_block_is_forbidden(client: AsyncClient):
    admin = await register_and_login(client, "founder@vibeus.test")
    customer = await register_and_login(client, "blocked@vibeus.test")
    await elevate(client, admin)

    blocked = await client.post(
        f"/api/control/users/{customer['user']['id']}/block",
        headers=admin["headers"],
        json={"reason": "Confirmed abusive automation during support review"},
    )
    assert blocked.status_code == 200, blocked.text
    assert blocked.json()["is_active"] is False
    assert blocked.json()["sessions_revoked"] >= 1

    customer_me = await client.get("/api/auth/me", headers=customer["headers"])
    assert customer_me.status_code == 401

    self_block = await client.post(
        f"/api/control/users/{admin['user']['id']}/block",
        headers=admin["headers"],
        json={"reason": "Should never be allowed for the current platform admin"},
    )
    assert self_block.status_code == 409


@pytest.mark.asyncio
async def test_project_inspector_does_not_return_secret_tokens_and_can_revoke_without_disclosure(client: AsyncClient):
    admin = await register_and_login(client, "founder@vibeus.test")
    customer = await register_and_login(client, "project-owner@vibeus.test")
    await elevate(client, admin)

    workspace = await client.post(
        "/api/workspaces",
        headers=customer["headers"],
        json={"name": "Project Workspace"},
    )
    workspace_id = workspace.json()["id"]
    created = await client.post(
        "/api/projects",
        headers=customer["headers"],
        json={
            "name": "Secret Project",
            "slug": "secret-project",
            "workspace_id": workspace_id,
        },
    )
    assert created.status_code == 200, created.text
    raw_api_token = created.json()["token"]
    raw_ingest_key = created.json()["ingest_key"]
    project_id = created.json()["id"]

    inspected = await client.get(
        f"/api/control/projects/{project_id}",
        headers=admin["headers"],
    )
    assert inspected.status_code == 200, inspected.text
    payload = inspected.json()
    serialized = str(payload)
    assert payload["project"]["api_token_configured"] is True
    assert payload["project"]["ingest_key_configured"] is True
    assert raw_api_token not in serialized
    assert raw_ingest_key not in serialized
    assert payload["secret_policy"]["api_token"].startswith("never displayed")

    revoked = await client.post(
        f"/api/control/projects/{project_id}/revoke-api-token",
        headers=admin["headers"],
        json={"reason": "Credential rotation requested after possible disclosure"},
    )
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["api_token_configured"] is False

    old_token_access = await client.get(
        "/api/projects/secret-project",
        headers={"Authorization": f"Bearer {raw_api_token}"},
    )
    assert old_token_access.status_code in {401, 404}


@pytest.mark.asyncio
async def test_overview_operations_and_roadmap_are_read_only_admin_surfaces(client: AsyncClient):
    admin = await register_and_login(client, "founder@vibeus.test")

    overview = await client.get("/api/control/overview", headers=admin["headers"])
    assert overview.status_code == 200
    assert overview.json()["users"]["total"] >= 1

    operations = await client.get("/api/control/operations", headers=admin["headers"])
    assert operations.status_code == 200
    assert operations.json()["database"]["ok"] is True
    assert operations.json()["secrets_exposed"] is False

    roadmap = await client.get("/api/control/roadmap", headers=admin["headers"])
    assert roadmap.status_code == 200
    payload = roadmap.json()
    assert payload["implemented_surface"] == "/control/workbench"
    assert payload["implemented_capabilities_endpoint"] == "/api/control/founder/capabilities"
    titles = {item["title"] for item in payload["items"]}
    assert titles == {
        "Platform-admin passkey / MFA",
        "Provider-side refund and recurring cancellation adapters",
    }
