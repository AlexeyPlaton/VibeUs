import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from models import Base, Project, SpecNode, SpecTicket
import crud

SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, class_=AsyncSession, expire_on_commit=False)

async def override_get_db():
    async with TestingSessionLocal() as session:
        yield session

from main import app
from database import get_db
import main
app.dependency_overrides[get_db] = override_get_db
main.async_session = TestingSessionLocal

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

@pytest.mark.asyncio
async def test_sync_board_creates_and_persists_ticket_in_same_session():
    async with TestingSessionLocal() as db:
        # 1. Create project
        project = await crud.get_or_create_project_by_slug(db, "platim-vmeste")
        initial_board = await crud.get_full_board(db, project.id)
        assert len(initial_board["nodes"]) >= 1
        node_id = initial_board["nodes"][0]["id"]
        assert len(initial_board["nodes"][0]["tickets"]) == 0

        # 2. Simulate incoming WebSocket payload with a new ticket
        incoming_payload = {
            "project_id": project.id,
            "slug": "platim-vmeste",
            "nodes": [
                {
                    "id": node_id,
                    "title": "Общие задачи и спецификация",
                    "description": "Раздел задач проекта",
                    "content_markdown": "### Спецификация проекта",
                    "tickets": [
                        {
                            "id": "TKT-999",
                            "key": "TKT-1",
                            "title": "Новая платежная интеграция",
                            "summary": "Подключить платежный шлюз СБП",
                            "status": "backlog",
                            "priority": "high",
                            "checklists": {"DoD 1": True, "DoD 2": False}
                        }
                    ]
                }
            ]
        }

        # 3. Execute sync_board_from_ws followed immediately by get_full_board in the same session
        await crud.sync_board_from_ws(db, project.id, incoming_payload)
        updated_board = await crud.get_full_board(db, project.id)

        # 4. Verify that the ticket was NOT lost and is returned in the board
        assert len(updated_board["nodes"]) == 1
        tickets = updated_board["nodes"][0]["tickets"]
        assert len(tickets) == 1
        assert tickets[0]["id"] == "TKT-999"
        assert tickets[0]["title"] == "Новая платежная интеграция"
        assert tickets[0]["status"] == "backlog"
        assert tickets[0]["priority"] == "high"

@pytest.mark.asyncio
async def test_sync_board_updates_existing_ticket_and_adds_second():
    async with TestingSessionLocal() as db:
        project = await crud.get_or_create_project_by_slug(db, "test-multi-ticket")
        initial_board = await crud.get_full_board(db, project.id)
        node_id = initial_board["nodes"][0]["id"]

        # Add 1st ticket
        payload_1 = {
            "project_id": project.id,
            "nodes": [
                {
                    "id": node_id,
                    "title": "Раздел 1",
                    "tickets": [
                        {
                            "id": "T1",
                            "title": "Ticket 1",
                            "status": "backlog"
                        }
                    ]
                }
            ]
        }
        await crud.sync_board_from_ws(db, project.id, payload_1)
        board_1 = await crud.get_full_board(db, project.id)
        assert len(board_1["nodes"][0]["tickets"]) == 1

        # Update 1st ticket and add 2nd ticket
        payload_2 = {
            "project_id": project.id,
            "nodes": [
                {
                    "id": node_id,
                    "title": "Раздел 1",
                    "tickets": [
                        {
                            "id": "T1",
                            "title": "Ticket 1 (Updated)",
                            "status": "in_progress"
                        },
                        {
                            "id": "T2",
                            "title": "Ticket 2",
                            "status": "backlog"
                        }
                    ]
                }
            ]
        }
        await crud.sync_board_from_ws(db, project.id, payload_2)
        board_2 = await crud.get_full_board(db, project.id)
        
        tickets = board_2["nodes"][0]["tickets"]
        assert len(tickets) == 2
        t1 = next(t for t in tickets if t["id"] == "T1")
        t2 = next(t for t in tickets if t["id"] == "T2")
        assert t1["title"] == "Ticket 1 (Updated)"
        assert t1["status"] == "in_progress"
        assert t2["title"] == "Ticket 2"

@pytest.mark.asyncio
async def test_sync_board_child_node_hierarchy_and_custom_boards():
    async with TestingSessionLocal() as db:
        project = await crud.get_or_create_project_by_slug(db, "hierarchy-boards-test")
        initial_board = await crud.get_full_board(db, project.id)
        root_node_id = initial_board["nodes"][0]["id"]
        
        payload = {
            "project_id": project.id,
            "custom_boards": [
                {"id": "board-frontend", "title": "Frontend", "description": "UI Tasks"}
            ],
            "nodes": [
                {
                    "id": root_node_id,
                    "parent_id": None,
                    "title": "Общие задачи и спецификация",
                    "tickets": []
                },
                {
                    "id": "child-oauth",
                    "parent_id": root_node_id,
                    "title": "OAuth 2.0 & Telegram Login",
                    "tickets": [
                        {
                            "id": "T-OAUTH-1",
                            "title": "Интеграция TG Login",
                            "status": "backlog"
                        }
                    ]
                }
            ]
        }
        
        await crud.sync_board_from_ws(db, project.id, payload)
        board = await crud.get_full_board(db, project.id)
        
        assert len(board["nodes"]) == 2
        root_node = next(n for n in board["nodes"] if n["id"] == root_node_id)
        child_node = next(n for n in board["nodes"] if n["id"] == "child-oauth")
        
        assert root_node["parent_id"] is None
        assert child_node["parent_id"] == root_node_id
        assert len(child_node["tickets"]) == 1
        assert child_node["tickets"][0]["title"] == "Интеграция TG Login"
        
        assert len(board["custom_boards"]) == 1
        assert board["custom_boards"][0]["id"] == "board-frontend"
        assert board["custom_boards"][0]["title"] == "Frontend"

@pytest.mark.asyncio
async def test_sync_board_permanent_delete_ticket_and_node():
    async with TestingSessionLocal() as db:
        project = await crud.get_or_create_project_by_slug(db, "delete-persistence-test")
        initial_board = await crud.get_full_board(db, project.id)
        node_id = initial_board["nodes"][0]["id"]
        
        # 1. Add 2 tickets
        payload_1 = {
            "project_id": project.id,
            "nodes": [
                {
                    "id": node_id,
                    "title": "Раздел",
                    "tickets": [
                        {"id": "DEL-1", "title": "Ticket to keep", "status": "backlog"},
                        {"id": "DEL-2", "title": "Ticket to delete", "status": "backlog"}
                    ]
                }
            ]
        }
        await crud.sync_board_from_ws(db, project.id, payload_1)
        board_1 = await crud.get_full_board(db, project.id)
        assert len(board_1["nodes"][0]["tickets"]) == 2
        
        # 2. Delete DEL-2 from payload and sync
        payload_2 = {
            "project_id": project.id,
            "nodes": [
                {
                    "id": node_id,
                    "title": "Раздел",
                    "tickets": [
                        {"id": "DEL-1", "title": "Ticket to keep", "status": "backlog"}
                    ]
                }
            ]
        }
        await crud.sync_board_from_ws(db, project.id, payload_2)
        
        # 3. Reload full board from DB and ensure DEL-2 is gone permanently
        board_2 = await crud.get_full_board(db, project.id)
        assert len(board_2["nodes"][0]["tickets"]) == 1
        assert board_2["nodes"][0]["tickets"][0]["id"] == "DEL-1"
        assert not any(t["id"] == "DEL-2" for t in board_2["nodes"][0]["tickets"])

