import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
import uuid

from main import app
import main
from database import get_db
from models import Base, Project, SpecNode, SpecTicket

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
    app.dependency_overrides[get_db] = override_get_db
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    main.async_session = orig_session
    main.engine = orig_engine

@pytest.mark.asyncio
async def test_mcp_tools_list():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/api/mcp/tools")
        assert res.status_code == 200
        data = res.json()
        assert "tools" in data
        tool_names = [t["name"] for t in data["tools"]]
        assert "vibus_list_tickets" in tool_names
        assert "vibus_get_ticket_details" in tool_names
        assert "vibus_update_ticket_status" in tool_names
        assert "vibus_create_ticket" in tool_names
        assert "vibus_sync_github" in tool_names

@pytest.mark.asyncio
async def test_mcp_execute_flow():
    # Setup test project and ticket in DB
    proj_slug = f"test_mcp_{uuid.uuid4().hex[:6]}"
    raw_token = f"vb_live_test_{uuid.uuid4().hex[:12]}"
    from security import hash_access_token
    async with TestingSessionLocal() as db:
        proj = Project(
            id=str(uuid.uuid4()),
            name="MCP Test Project",
            slug=proj_slug,
            api_token_digest=hash_access_token(raw_token)
        )
        db.add(proj)
        await db.commit()
        
        node = SpecNode(
            id=str(uuid.uuid4()),
            project_id=proj.id,
            title="UI Section"
        )
        db.add(node)
        await db.commit()
        
        ticket = SpecTicket(
            id=str(uuid.uuid4()),
            node_id=node.id,
            key="TST-1",
            title="Button color glitch",
            summary="Button is pink instead of purple",
            priority="high",
            status="backlog"
        )
        db.add(ticket)
        await db.commit()
        ticket_id = ticket.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 0. Anonymous call must be rejected
        res_anon = await ac.post("/api/mcp/execute", json={
            "name": "vibus_list_tickets",
            "arguments": {"project_slug": proj_slug}
        })
        assert res_anon.status_code == 401

        headers = {"X-API-Token": raw_token}

        # 1. List tickets via MCP
        res_list = await ac.post("/api/mcp/execute", json={
            "name": "vibus_list_tickets",
            "arguments": {"project_slug": proj_slug}
        }, headers=headers)
        assert res_list.status_code == 200
        content = res_list.json()["content"][0]["text"]
        assert "Button color glitch" in content

        # 2. Get ticket details via MCP
        res_detail = await ac.post("/api/mcp/execute", json={
            "name": "vibus_get_ticket_details",
            "arguments": {"ticket_id": "TST-1", "project_slug": proj_slug}
        }, headers=headers)
        assert res_detail.status_code == 200
        content_detail = res_detail.json()["content"][0]["text"]
        assert "Button is pink instead of purple" in content_detail

        # 3. Update status via MCP
        res_update = await ac.post("/api/mcp/execute", json={
            "name": "vibus_update_ticket_status",
            "arguments": {
                "project_slug": proj_slug,
                "ticket_id": ticket_id,
                "status": "in_progress",
                "rework_notes": "AI agent started analyzing the styles"
            }
        }, headers=headers)
        assert res_update.status_code == 200
        assert "in_progress" in res_update.json()["content"][0]["text"]

        # 4. Create new ticket via MCP
        res_create = await ac.post("/api/mcp/execute", json={
            "name": "vibus_create_ticket",
            "arguments": {
                "project_slug": proj_slug,
                "title": "Fix navbar margin",
                "summary": "Margin is too small on mobile",
                "priority": "medium"
            }
        }, headers=headers)
        assert res_create.status_code == 200
        assert "Fix navbar margin" in res_create.json()["content"][0]["text"]
