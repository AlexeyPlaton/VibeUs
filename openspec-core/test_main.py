import pytest
import json
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
import pytest_asyncio
import stripe_service
import yookassa_service
import pricing
stripe_service.ALLOW_MOCK_BILLING = True
yookassa_service.ALLOW_MOCK_BILLING = True
from starlette.testclient import TestClient

from main import app
from database import get_db
from models import Base
from sqlalchemy import select
import models
import security
import main
from datetime import timedelta

# Use in-memory sqlite for testing
SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

engine = create_async_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, class_=AsyncSession, expire_on_commit=False)

async def override_get_db():
    async with TestingSessionLocal() as session:
        yield session

app.dependency_overrides[get_db] = override_get_db
main.engine = engine

@pytest_asyncio.fixture(autouse=True)
async def prepare_database():
    orig_session = main.async_session
    orig_engine = main.engine
    main.async_session = TestingSessionLocal
    main.engine = engine
    main.limiter.enabled = False
    app.dependency_overrides[get_db] = override_get_db
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    main.async_session = orig_session
    main.engine = orig_engine
    main.limiter.enabled = True

@pytest_asyncio.fixture
async def async_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

async def get_auth_headers(client: AsyncClient, email: str = "tester@vibus.dev") -> dict:
    await client.post("/api/auth/register", json={
        "email": email,
        "password": "Correct-Horse-42!Battery",
        "accept_terms": True,
        "terms_version": "test-v1",
        "privacy_version": "test-v1",
    })
    res = await client.post("/api/auth/login", json={"email": email, "password": "Correct-Horse-42!Battery"})
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

async def create_test_workspace(client: AsyncClient, headers: dict, name: str = "Test Workspace") -> str:
    res = await client.post("/api/workspaces", json={"name": name}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()["id"]

@pytest.mark.asyncio
async def test_read_main(async_client: AsyncClient):
    response = await async_client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "Vibus Cloud is running"
    assert data["version"] == "2.4.0"

@pytest.mark.asyncio
async def test_workspace_and_paywalls(async_client: AsyncClient):
    # 0. Register and login
    headers = await get_auth_headers(async_client, "founder@acme.com")

    # 1. Create Workspace with Free Tier
    ws_res = await async_client.post("/api/workspaces", json={"name": "Acme Corp"}, headers=headers)
    assert ws_res.status_code == 200
    ws = ws_res.json()
    ws_id = ws["id"]
    assert ws["subscription_tier"] == "free"

    # 2. Create 1st project in Free workspace -> 200 OK
    p1_res = await async_client.post("/api/projects", json={
        "name": "Project One",
        "slug": "proj-1",
        "workspace_id": ws_id
    }, headers=headers)
    assert p1_res.status_code == 200
    token1 = p1_res.json()["token"]

    # 3. Create 2nd project in Free workspace -> 402 Payment Required (Paywall!)
    p2_fail = await async_client.post("/api/projects", json={
        "name": "Project Two",
        "slug": "proj-2",
        "workspace_id": ws_id
    }, headers=headers)
    assert p2_fail.status_code == 402

    # 4. Direct tier upgrade is forbidden in production (403)
    unauth_upgrade = await async_client.put(f"/api/workspaces/{ws_id}/tier?tier=pro")
    assert unauth_upgrade.status_code == 403

    # 5. Upgrade workspace tier to pro
    async with TestingSessionLocal() as db:
        res_ws = await db.execute(select(models.Workspace).where(models.Workspace.id == ws_id))
        ws_obj = res_ws.scalar_one()
        ws_obj.subscription_tier = "pro"
        ws_obj.subscription_status = "active"
        ws_obj.current_period_start = models.utcnow()
        ws_obj.current_period_end = models.utcnow() + timedelta(days=30)
        await db.commit()

    # 6. Now create 2nd project -> 200 OK
    p2_res = await async_client.post("/api/projects", json={
        "name": "Project Two",
        "slug": "proj-2",
        "workspace_id": ws_id
    }, headers=headers)
    assert p2_res.status_code == 200

    # 7. Check board returns status 200
    board_res = await async_client.get("/api/projects/proj-1/board", headers={"X-API-Token": token1})
    assert board_res.status_code == 200

@pytest.mark.asyncio
async def test_strict_auth_and_leak_prevention(async_client: AsyncClient):
    auth_h = await get_auth_headers(async_client, "secret@vibus.dev")
    ws_id = await create_test_workspace(async_client, auth_h, "Secret Workspace")
    payload = {
        "name": "Secret Project",
        "description": "Sensitive specs inside",
        "slug": "secret-slug",
        "workspace_id": ws_id
    }
    response = await async_client.post("/api/projects", json=payload, headers=auth_h)
    assert response.status_code == 200
    token = response.json()["token"]

    # Unauthenticated GET for sensitive project metadata fails with 401/404
    leak_attempt = await async_client.get("/api/projects/secret-slug")
    assert leak_attempt.status_code in [401, 404]

    # Unauthenticated GET on board now strictly fails with 401/404 (Tenant Isolation!)
    board_leak = await async_client.get("/api/projects/secret-slug/board")
    assert board_leak.status_code in [401, 404]

    # Authenticated request succeeds
    auth_resp = await async_client.get("/api/projects/secret-slug", headers={"Authorization": f"Bearer {token}"})
    assert auth_resp.status_code == 200
    assert auth_resp.json()["slug"] == "secret-slug"

    auth_board = await async_client.get("/api/projects/secret-slug/board", headers={"Authorization": f"Bearer {token}"})
    assert auth_board.status_code == 200

@pytest.mark.asyncio
async def test_public_feedback_submission_without_token(async_client: AsyncClient):
    auth_h = await get_auth_headers(async_client, "public@vibus.dev")
    ws_id = await create_test_workspace(async_client, auth_h, "Public Workspace")
    proj_res = await async_client.post("/api/projects", json={"name": "Public Project", "slug": "public-proj", "workspace_id": ws_id}, headers=auth_h)
    assert proj_res.status_code == 200
    token = proj_res.json()["token"]
    pub_key = proj_res.json()["public_widget_key"]

    fb_payload = {
        "text": "Great tool! Found a minor typo on navbar.",
        "author": "Alice",
        "contact": "@alice_tg",
        "quote": "Vibus Studio"
    }
    fb_res = await async_client.post(
        "/api/projects/public-proj/feedback", 
        json=fb_payload, 
        headers={"X-Vibus-Public-Key": pub_key}
    )
    assert fb_res.status_code == 200
    assert fb_res.json()["status"] == "ok"

    board_res = await async_client.get("/api/projects/public-proj/board", headers={"X-API-Token": token})
    assert board_res.status_code == 200
    feedbacks = board_res.json()["feedbacks"]
    assert len(feedbacks) == 1
    assert feedbacks[0]["author"] == "Alice"

@pytest.mark.asyncio
async def test_nodes_and_tickets_crud_and_soft_delete(async_client: AsyncClient):
    auth_h = await get_auth_headers(async_client, "nodes_tickets@vibus.dev")
    ws_id = await create_test_workspace(async_client, auth_h, "Nodes Workspace")
    proj_res = await async_client.post("/api/projects", json={"name": "P1", "slug": "p1-demo", "workspace_id": ws_id}, headers=auth_h)
    assert proj_res.status_code == 200
    token = proj_res.json()["token"]
    headers = {"X-API-Token": token}

    node_res = await async_client.post("/api/projects/p1-demo/nodes", json={"title": "Auth Module"}, headers=headers)
    assert node_res.status_code == 200
    node_id = node_res.json()["id"]

    ticket_res = await async_client.post(
        f"/api/projects/p1-demo/nodes/{node_id}/tickets",
        json={"title": "Fix OAuth login", "status": "backlog", "priority": "high"},
        headers=headers
    )
    assert ticket_res.status_code == 200
    ticket_id = ticket_res.json()["id"]

    update_res = await async_client.put(
        f"/api/projects/p1-demo/tickets/{ticket_id}",
        json={"status": "in_progress"},
        headers=headers
    )
    assert update_res.status_code == 200

    del_res = await async_client.delete(f"/api/projects/p1-demo/tickets/{ticket_id}", headers=headers)
    assert del_res.status_code == 200

    board_res = await async_client.get("/api/projects/p1-demo/board", headers=headers)
    assert len(board_res.json()["nodes"][0]["tickets"]) == 0

def test_websocket_strict_auth():
    with TestClient(app) as client:
        client.post("/api/auth/register", json={"email": "ws_user@vibus.dev", "password": "Correct-Horse-42!Battery", "accept_terms": True, "terms_version": "test-v1", "privacy_version": "test-v1"})
        l_res = client.post("/api/auth/login", json={"email": "ws_user@vibus.dev", "password": "Correct-Horse-42!Battery"})
        auth_hdr = {"Authorization": f"Bearer {l_res.json()['access_token']}"}

        ws_res = client.post("/api/workspaces", json={"name": "WS Workspace"}, headers=auth_hdr)
        assert ws_res.status_code == 200
        ws_id = ws_res.json()["id"]

        res = client.post("/api/projects", json={"name": "WS Sec Project", "slug": "ws-sec", "workspace_id": ws_id}, headers=auth_hdr)
        assert res.status_code == 200
        token = res.json()["token"]

        with client.websocket_connect("/ws/sync/ws-sec") as ws_auth:
            ws_auth.send_json({"type": "auth", "token": token})
            auth_ack = ws_auth.receive_json()
            assert auth_ack["type"] == "auth_ok"
            initial = ws_auth.receive_json()
            assert initial["type"] == "board.snapshot"

@pytest.mark.asyncio
async def test_safe_project_deletion_and_protection(async_client: AsyncClient):
    auth_h = await get_auth_headers(async_client, "ephemeral@vibus.dev")
    ws_id = await create_test_workspace(async_client, auth_h, "Ephemeral Workspace")
    res = await async_client.post("/api/projects", json={"name": "Ephemeral Project", "slug": "ephemeral-1", "workspace_id": ws_id}, headers=auth_h)
    assert res.status_code == 200
    token = res.json()["token"]
    headers = {"X-API-Token": token}

    # 2. Deletion without auth token fails (401/404)
    unauth = await async_client.delete("/api/projects/ephemeral-1?confirmation_slug=ephemeral-1")
    assert unauth.status_code in [401, 404]

    # 3. Deletion with mismatched confirmation slug fails (400)
    mismatch = await async_client.delete("/api/projects/ephemeral-1?confirmation_slug=wrong-slug", headers=headers)
    assert mismatch.status_code == 400

    # 4. Deletion with valid confirmation slug succeeds (200)
    del_ok = await async_client.delete("/api/projects/ephemeral-1?confirmation_slug=ephemeral-1", headers=headers)
    assert del_ok.status_code == 200
    assert del_ok.json()["deleted"] is True

    # 5. Subsequent access to project metadata fails with 404
    get_res = await async_client.get("/api/projects/ephemeral-1", headers=headers)
    assert get_res.status_code in [401, 404]

@pytest.mark.asyncio
async def test_billing_and_promo_redemption(async_client: AsyncClient):
    headers = await get_auth_headers(async_client, "billing@test.com")

    # 1. Create Workspace
    ws_res = await async_client.post("/api/workspaces", json={"name": "Billing Test Co"}, headers=headers)
    assert ws_res.status_code == 200
    ws = ws_res.json()
    ws_id = ws["id"]
    assert ws["is_lifetime_free"] is False

    # 2. The legacy checkout-shaped endpoint now performs the first-party
    # CloudPayments billing-country/business-use handoff. Entitlements are
    # granted only by verified provider notifications, covered by the dedicated
    # CloudPayments webhook tests.
    checkout_res = await async_client.post("/api/billing/create-checkout-session", json={
        "workspace_id": ws_id,
        "tier": "solo"
    }, headers=headers)
    assert checkout_res.status_code == 200
    checkout = checkout_res.json()
    assert checkout["provider"] == "cloudpayments"
    assert checkout["requires_billing_details"] is True
    assert "/billing/international?" in checkout["checkout_url"]
    assert f"workspace={ws_id}" in checkout["checkout_url"]

    # 3. Redeem Promo Code (LAUNCH_VIP_2026) -> Upgrades to Lifetime Solo
    async with TestingSessionLocal() as db:
        db.add(models.PromoCode(
            code_digest=security.hash_access_token("LAUNCH_VIP_2026"),
            tier="pro",
            duration_days=None,
            grants_lifetime=True,
            max_uses=100,
            times_used=0,
            is_active=True
        ))
        await db.commit()

    promo_res = await async_client.post(f"/api/workspaces/{ws_id}/redeem-promo", json={
        "code": "LAUNCH_VIP_2026"
    }, headers=headers)
    assert promo_res.status_code == 200
    updated_ws = promo_res.json()
    assert updated_ws["subscription_tier"] == "solo"
    assert updated_ws["is_lifetime_free"] is True
    assert updated_ws["promo_code_used"] == security.hash_access_token("LAUNCH_VIP_2026")

@pytest.mark.asyncio
async def test_yookassa_payment_and_webhook(async_client: AsyncClient):
    headers = await get_auth_headers(async_client, "ceo@rustudio.ru")

    # 1. Create Workspace
    ws_res = await async_client.post("/api/workspaces", json={"name": "Ru Studio LLC"}, headers=headers)
    assert ws_res.status_code == 200
    ws_id = ws_res.json()["id"]

    # 2. Create YooKassa payment session (Mock in dev)
    yk_res = await async_client.post("/api/billing/yookassa/create-payment", json={
        "workspace_id": ws_id,
        "tier": "solo",
        "return_url": "https://vibus.dev/billing/success"
    }, headers=headers)
    assert yk_res.status_code == 200
    yk_data = yk_res.json()
    assert "confirmation_url" in yk_data
    expected_rub = f"{pricing.amount('ru', 'solo'):.2f}"
    assert yk_data["amount"] == expected_rub

    yk_payment_id = yk_data["payment_id"]

    # 3. Simulate YooKassa Webhook (payment.succeeded)
    webhook_res = await async_client.post(
        "/api/billing/yookassa/webhook",
        json={
            "type": "notification",
            "event": "payment.succeeded",
            "object": {
                "id": yk_payment_id,
                "status": "succeeded",
                "amount": {"value": expected_rub, "currency": "RUB"},
                "metadata": {
                    "workspace_id": ws_id,
                    "tier": "solo"
                }
            }
        }
    )
    assert webhook_res.status_code == 200
    # 4. Test Webhook Idempotency (Repeat same webhook -> duplicate: True)
    repeat_res = await async_client.post(
        "/api/billing/yookassa/webhook",
        json={
            "type": "notification",
            "event": "payment.succeeded",
            "object": {
                "id": yk_payment_id,
                "status": "succeeded",
                "amount": {"value": expected_rub, "currency": "RUB"},
                "metadata": {
                    "workspace_id": ws_id,
                    "tier": "solo"
                }
            }
        }
    )
    assert repeat_res.status_code == 200
    assert repeat_res.json().get("duplicate") is True

    # 5. Verify workspace is now Solo
    get_ws = await async_client.get(f"/api/workspaces/{ws_id}", headers=headers)
    assert get_ws.status_code == 200
    assert get_ws.json()["subscription_tier"] in ["pro", "solo"]
    assert get_ws.json()["subscription_status"] == "active"
    assert get_ws.json()["current_period_end"] is not None

    # 6. Test payment method refusal (152-FZ / consumer rights 01.03.2026)
    refuse_res = await async_client.post(
        f"/api/workspaces/{ws_id}/refuse-payment-method",
        headers=headers
    )
    assert refuse_res.status_code == 200
    assert refuse_res.json().get("payment_method_refused") is True

@pytest.mark.asyncio
async def test_access_links_server_validation_and_single_use(async_client: AsyncClient):
    auth_h = await get_auth_headers(async_client, "links@vibus.dev")
    ws_id = await create_test_workspace(async_client, auth_h, "Links Workspace")
    # 1. Create project
    proj_res = await async_client.post("/api/projects", json={"name": "Access Link Proj", "slug": "link-proj", "workspace_id": ws_id}, headers=auth_h)
    assert proj_res.status_code == 200
    token = proj_res.json()["token"]
    headers = {"X-API-Token": token}

    # 2. Create single-use Access Link
    link_res = await async_client.post(
        "/api/projects/link-proj/access-links",
        json={"label": "Client QA", "role": "reviewer", "ttl": "24h", "single_use": True},
        headers=headers
    )
    assert link_res.status_code == 200
    link_data = link_res.json()
    link_token = link_data["token"]
    assert link_data["single_use"] is True

    # 3. First verification from device A -> Succeeds
    v1 = await async_client.post("/api/access-links/verify", json={
        "token": link_token,
        "fingerprint": "device_fingerprint_A"
    })
    assert v1.status_code == 200
    assert v1.json()["valid"] is True
    assert v1.json()["role"] == "reviewer"

    # 4. Second verification from same device A -> Succeeds
    v2 = await async_client.post("/api/access-links/verify", json={
        "token": link_token,
        "fingerprint": "device_fingerprint_A"
    })
    assert v2.status_code == 200
    assert v2.json()["valid"] is True

    # 5. Third verification from different device B -> Fails (single-use device bound!)
    v3 = await async_client.post("/api/access-links/verify", json={
        "token": link_token,
        "fingerprint": "device_fingerprint_B"
    })
    assert v3.status_code == 200
    assert v3.json()["valid"] is False
    assert "Link already used" in v3.json()["error"]



