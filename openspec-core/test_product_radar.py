import types
from datetime import timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

import control_router
import main
import models
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
        "user": register.json(),
    }


@pytest.mark.asyncio
async def test_product_radar_is_platform_admin_only_and_reports_core_value_loop(client: AsyncClient):
    admin = await register_and_login(client, "founder@vibeus.test")
    customer = await register_and_login(client, "radar-customer@vibeus.test")

    denied = await client.get("/api/control/radar", headers=customer["headers"])
    assert denied.status_code == 403

    workspace = await client.post(
        "/api/workspaces",
        headers=customer["headers"],
        json={"name": "Radar Workspace", "first_touch_source": "launch-test"},
    )
    assert workspace.status_code == 200, workspace.text

    project = await client.post(
        "/api/projects",
        headers=customer["headers"],
        json={
            "name": "Radar Project",
            "slug": "radar-project",
            "workspace_id": workspace.json()["id"],
        },
    )
    assert project.status_code == 200, project.text

    async with TestingSessionLocal() as db:
        db.add(models.Feedback(
            project_id=project.json()["id"],
            text="Launch customer captured real feedback",
            category="idea",
            status="new",
        ))
        await db.commit()

    response = await client.get("/api/control/radar", headers=admin["headers"])
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["north_star"]["key"] == "weekly_value_workspaces"
    assert body["north_star"]["value"] == 1
    assert "feedback item or runtime-error" in body["north_star"]["definition"]

    dimension_keys = {item["key"] for item in body["dimensions"]}
    assert dimension_keys == {
        "reach",
        "activation",
        "value",
        "return",
        "delivery",
        "monetize",
        "cash_trust",
        "learn",
    }
    assert body["leading_indicators"]["activation_24h"]["numerator"] >= 1
    assert body["leading_indicators"]["first_value"]["sample"] >= 1
    assert any(item["priority"] == "P2" and item["area"] == "Evidence" for item in body["steering_queue"])

    guardrails = {item["key"]: item for item in body["guardrails"]}
    assert guardrails["platform_slo"]["status"] == "unknown"
    assert "Customer runtime errors" in guardrails["platform_slo"]["detail"]

    gap_keys = {item["key"] for item in body["data_coverage"]["gaps"]}
    assert "onboarding_step" in gap_keys
    assert "platform_5xx_latency" in gap_keys
    assert "deployment_release" in gap_keys
    assert body["data_coverage"]["pct"] < 80


@pytest.mark.asyncio
async def test_radar_escalates_cash_integrity_before_growth(client: AsyncClient):
    admin = await register_and_login(client, "founder@vibeus.test")

    async with TestingSessionLocal() as db:
        workspace = models.Workspace(name="Billing Watch", owner_email="billing@example.test")
        db.add(workspace)
        await db.flush()
        db.add(models.Payment(
            provider="manual-test",
            provider_payment_id="radar_pending_payment",
            workspace_id=workspace.id,
            plan="solo",
            amount_minor=149000,
            currency="RUB",
            status="pending",
            is_test=False,
            tax_mode="npd",
            fiscal_status="receipt_not_required",
            created_at=models.utcnow() - timedelta(minutes=30),
        ))
        await db.commit()

    response = await client.get("/api/control/radar", headers=admin["headers"])
    assert response.status_code == 200, response.text
    queue = response.json()["steering_queue"]
    assert queue[0]["priority"] == "P0"
    assert queue[0]["area"] == "Cash & trust"
    assert "before growth" in queue[0]["title"]
