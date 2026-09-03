import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from database import get_db
from models import Base
import main
from main import app

SQLALCHEMY_DATABASE_URL = 'sqlite+aiosqlite:///:memory:'
engine = create_async_engine(SQLALCHEMY_DATABASE_URL, connect_args={'check_same_thread': False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, class_=AsyncSession, expire_on_commit=False)

async def override_get_db():
    async with TestingSessionLocal() as session:
        yield session

app.dependency_overrides[get_db] = override_get_db
main.engine = engine
main.async_session = TestingSessionLocal

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

@pytest_asyncio.fixture
async def async_client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as ac:
        yield ac


def legal_registration_payload(email: str) -> dict:
    return {
        'email': email,
        'password': 'Correct-Horse-42!Battery',
        'legal_locale': 'en',
        'accept_terms': True,
        'acknowledge_privacy': True,
        'consent_personal_data': False,
        'terms_version': 'test-v1',
        'privacy_version': 'test-v1',
        'personal_data_consent_version': None,
    }


@pytest.mark.asyncio
async def test_authorization_matrix(async_client: AsyncClient):
    # 1. Anonymous access
    ws_res = await async_client.post('/api/workspaces', json={'name': 'Anon WS'})
    assert ws_res.status_code == 401

    # 2. Register User 1
    reg1 = await async_client.post('/api/auth/register', json=legal_registration_payload('u1@test.com'))
    assert reg1.status_code == 200, reg1.text
    login1 = await async_client.post('/api/auth/login', json={'email': 'u1@test.com', 'password': 'Correct-Horse-42!Battery'})
    t1 = login1.json()['access_token']
    h1 = {'Authorization': f'Bearer {t1}'}

    # 3. Create Workspace with User 1
    ws_res = await async_client.post('/api/workspaces', json={'name': 'WS1'}, headers=h1)
    assert ws_res.status_code == 200
    ws_id = ws_res.json()['id']

    # User 1 can read workspace
    get_res = await async_client.get(f'/api/workspaces/{ws_id}', headers=h1)
    assert get_res.status_code == 200

    # 4. Register User 2
    reg2 = await async_client.post('/api/auth/register', json=legal_registration_payload('u2@test.com'))
    assert reg2.status_code == 200, reg2.text
    login2 = await async_client.post('/api/auth/login', json={'email': 'u2@test.com', 'password': 'Correct-Horse-42!Battery'})
    t2 = login2.json()['access_token']
    h2 = {'Authorization': f'Bearer {t2}'}

    # 5. User 2 cannot read WS1
    get_res2 = await async_client.get(f'/api/workspaces/{ws_id}', headers=h2)
    assert get_res2.status_code == 404 # Isolated via require_workspace_capability returning 404

    # 6. Revoked token access
    await async_client.post('/api/auth/logout', headers=h1)
    get_res1_again = await async_client.get(f'/api/workspaces/{ws_id}', headers=h1)
    assert get_res1_again.status_code == 401


@pytest.mark.asyncio
async def test_single_use_team_access_link_reuses_same_device_on_rest(
    async_client: AsyncClient,
):
    import uuid

    import crud
    import schemas
    from models import Project, SpecNode
    from security import hash_access_token

    project_id = str(uuid.uuid4())
    slug = f"single-use-{uuid.uuid4().hex[:8]}"
    owner_token = f"owner_{uuid.uuid4().hex}"

    async with TestingSessionLocal() as db:
        project = Project(
            id=project_id,
            name="Single Use REST Test",
            slug=slug,
            api_token_digest=hash_access_token(owner_token),
            revision=0,
        )
        db.add(project)

        node = SpecNode(
            id=str(uuid.uuid4()),
            project_id=project_id,
            title="General",
            description="",
            content_markdown="",
            is_deleted=False,
        )
        db.add(node)

        await db.commit()

        link, raw_access_token = await crud.create_access_link(
            db,
            project_id,
            schemas.AccessLinkCreate(
                label="single-use-team-test",
                role=schemas.AccessLinkRoleEnum.team,
                ttl=schemas.TtlEnum.d7,
                single_use=True,
            ),
        )

        node_id = node.id

    device_a = "device-A-stable-fingerprint"
    device_b = "device-B-other-fingerprint"

    # Simulate the first WS/browser activation.
    activation = await async_client.post(
        "/api/access-links/verify",
        json={
            "token": raw_access_token,
            "fingerprint": device_a,
        },
    )

    assert activation.status_code == 200
    assert activation.json()["valid"] is True

    headers_a = {
        "X-API-Token": raw_access_token,
        "Authorization": f"Bearer {raw_access_token}",
        "X-Device-Fingerprint": device_a,
    }

    # The SAME device must be allowed to use REST after activation.
    create_ticket_res = await async_client.post(
        f"/api/projects/{slug}/nodes/{node_id}/tickets",
        headers=headers_a,
        json={
            "title": "Single-use device A write",
            "summary": "Must succeed after activation",
            "priority": "medium",
            "status": "backlog",
        },
    )

    assert create_ticket_res.status_code == 200, (
        create_ticket_res.text
    )

    # The same token + same fingerprint must remain usable.
    second_write = await async_client.post(
        f"/api/projects/{slug}/nodes",
        headers=headers_a,
        json={
            "title": "Second node by same device",
            "description": "",
            "parent_id": None,
            "content_markdown": "",
        },
    )

    assert second_write.status_code == 200, second_write.text

    # Another device must NOT steal the already activated link.
    headers_b = {
        "X-API-Token": raw_access_token,
        "Authorization": f"Bearer {raw_access_token}",
        "X-Device-Fingerprint": device_b,
    }

    foreign_device = await async_client.post(
        f"/api/projects/{slug}/nodes",
        headers=headers_b,
        json={
            "title": "Must not be created",
            "description": "",
            "parent_id": None,
            "content_markdown": "",
        },
    )

    assert foreign_device.status_code in (403, 404)

    # Missing fingerprint must also fail after activation.
    missing_fingerprint = await async_client.post(
        f"/api/projects/{slug}/nodes",
        headers={
            "X-API-Token": raw_access_token,
            "Authorization": f"Bearer {raw_access_token}",
        },
        json={
            "title": "Must not be created either",
            "description": "",
            "parent_id": None,
            "content_markdown": "",
        },
    )

    assert missing_fingerprint.status_code in (403, 404)


@pytest.mark.asyncio
async def test_project_capability_boundaries_owner_team_reviewer(
    async_client: AsyncClient,
    monkeypatch,
):
    """
    Security invariant:

    OWNER direct project token:
      - ordinary project writes: allowed
      - settings/admin operations: allowed
      - integration operations: allowed

    TEAM delegated access-link:
      - ordinary project writes: allowed
      - settings/admin operations: forbidden
      - integration operations: forbidden

    REVIEWER delegated access-link:
      - project read: allowed
      - project writes: forbidden
      - settings/admin operations: forbidden
      - integration operations: forbidden
    """

    import uuid
    from types import SimpleNamespace

    import crud
    import schemas
    import settings as settings_module

    from models import (
        Project,
        SpecNode,
        SpecTicket,
    )
    from security import hash_access_token


    # ---------------------------------------------------------
    # ARRANGE
    # ---------------------------------------------------------

    project_id = str(uuid.uuid4())
    slug = f"rbac-{uuid.uuid4().hex[:8]}"
    owner_token = f"owner_{uuid.uuid4().hex}"

    node_id = str(uuid.uuid4())
    existing_ticket_id = str(uuid.uuid4())

    async with TestingSessionLocal() as db:
        project = Project(
            id=project_id,
            name="RBAC Boundary Test",
            slug=slug,
            api_token_digest=hash_access_token(
                owner_token
            ),
            columns=[
                {
                    "id": "backlog",
                    "name": "Backlog",
                },
                {
                    "id": "custom",
                    "name": "Custom",
                },
            ],
            revision=0,
            is_deleted=False,
        )
        db.add(project)

        node = SpecNode(
            id=node_id,
            project_id=project_id,
            title="General",
            description="",
            content_markdown="",
            is_deleted=False,
        )
        db.add(node)

        existing_ticket = SpecTicket(
            id=existing_ticket_id,
            node_id=node_id,
            key="RBAC-1",
            title="RBAC existing ticket",
            summary="Used for authorization checks",
            status="backlog",
            priority="medium",
            checklists={},
            revision=0,
            is_deleted=False,
        )
        db.add(existing_ticket)

        await db.commit()

        team_link, team_token = await crud.create_access_link(
            db,
            project_id,
            schemas.AccessLinkCreate(
                label="RBAC team",
                role=schemas.AccessLinkRoleEnum.team,
                ttl=schemas.TtlEnum.d7,
                single_use=False,
            ),
        )

        reviewer_link, reviewer_token = (
            await crud.create_access_link(
                db,
                project_id,
                schemas.AccessLinkCreate(
                    label="RBAC reviewer",
                    role=schemas.AccessLinkRoleEnum.reviewer,
                    ttl=schemas.TtlEnum.d7,
                    single_use=False,
                ),
            )
        )

        team_link_id = team_link.id
        reviewer_link_id = reviewer_link.id


    def headers(token: str) -> dict[str, str]:
        return {
            "X-API-Token": token,
            "Authorization": f"Bearer {token}",
        }


    owner_headers = headers(owner_token)
    team_headers = headers(team_token)
    reviewer_headers = headers(reviewer_token)


    # Tunnel authorization should be tested independently
    # from environment flags.
    monkeypatch.setattr(
        settings_module,
        "get_settings",
        lambda: SimpleNamespace(
            enable_public_tunnels=True,
        ),
    )


    # ---------------------------------------------------------
    # 1. TEAM keeps normal project:write
    # ---------------------------------------------------------

    team_create_ticket = await async_client.post(
        f"/api/projects/{slug}/nodes/{node_id}/tickets",
        headers=team_headers,
        json={
            "title": "Team may create ticket",
            "summary": "project:write remains functional",
            "priority": "medium",
            "status": "backlog",
        },
    )

    assert team_create_ticket.status_code == 200, (
        team_create_ticket.text
    )

    team_ticket_id = team_create_ticket.json()["id"]

    team_update_ticket = await async_client.put(
        f"/api/projects/{slug}/tickets/{team_ticket_id}",
        headers=team_headers,
        json={
            "title": "Team may update ticket",
        },
    )

    assert team_update_ticket.status_code == 200, (
        team_update_ticket.text
    )


    # ---------------------------------------------------------
    # 2. REVIEWER is read-only
    # ---------------------------------------------------------

    reviewer_board = await async_client.get(
        f"/api/projects/{slug}/board",
        headers=reviewer_headers,
    )

    assert reviewer_board.status_code == 200, (
        reviewer_board.text
    )

    reviewer_write = await async_client.post(
        f"/api/projects/{slug}/nodes/{node_id}/tickets",
        headers=reviewer_headers,
        json={
            "title": "Reviewer must not create this",
            "summary": "",
            "priority": "medium",
            "status": "backlog",
        },
    )

    assert reviewer_write.status_code == 403, (
        reviewer_write.text
    )


    # ---------------------------------------------------------
    # Helpers for privileged route assertions
    # ---------------------------------------------------------

    async def assert_forbidden_for_delegated(
        method: str,
        path: str,
        *,
        json=None,
        params=None,
    ):
        for role_name, role_headers in (
            ("team", team_headers),
            ("reviewer", reviewer_headers),
        ):
            response = await async_client.request(
                method,
                path,
                headers=role_headers,
                json=json,
                params=params,
            )

            assert response.status_code == 403, (
                f"{role_name} unexpectedly passed "
                f"{method} {path}: "
                f"{response.status_code} {response.text}"
            )


    # ---------------------------------------------------------
    # 3. SETTINGS / ADMIN boundaries
    # ---------------------------------------------------------

    await assert_forbidden_for_delegated(
        "PATCH",
        f"/api/projects/{slug}/settings",
        json={
            "telemetry_enabled": True,
        },
    )

    await assert_forbidden_for_delegated(
        "DELETE",
        f"/api/projects/{slug}/columns/custom",
    )

    await assert_forbidden_for_delegated(
        "POST",
        f"/api/projects/{slug}/access-links",
        json={
            "label": "Privilege escalation attempt",
            "role": "team",
            "ttl": "7d",
            "single_use": False,
        },
    )

    await assert_forbidden_for_delegated(
        "GET",
        f"/api/projects/{slug}/access-links",
    )

    await assert_forbidden_for_delegated(
        "DELETE",
        (
            f"/api/projects/{slug}/access-links/"
            f"{reviewer_link_id}"
        ),
    )

    await assert_forbidden_for_delegated(
        "POST",
        f"/api/projects/{slug}/tunnels",
        json={
            "target_host": "127.0.0.1",
            "target_port": 5173,
            "ttl": "24h",
            "role": "reviewer",
            "single_use": False,
        },
    )

    await assert_forbidden_for_delegated(
        "DELETE",
        f"/api/projects/{slug}",
        params={
            "confirmation_slug": slug,
        },
    )


    # ---------------------------------------------------------
    # 4. INTEGRATION boundaries
    # ---------------------------------------------------------

    integration_routes = [
        (
            "GET",
            f"/api/projects/{slug}/github",
            None,
        ),
        (
            "POST",
            f"/api/projects/{slug}/github",
            {
                "github_repo": "owner/repo",
                "github_sync_enabled": False,
            },
        ),
        (
            "POST",
            f"/api/projects/{slug}/github/test",
            {
                "github_repo": "owner/repo",
                "github_sync_enabled": False,
            },
        ),
        (
            "POST",
            f"/api/projects/{slug}/github/sync",
            None,
        ),
        (
            "POST",
            (
                f"/api/projects/{slug}/tickets/"
                f"{existing_ticket_id}/github/sync"
            ),
            None,
        ),
    ]

    for method, path, body in integration_routes:
        await assert_forbidden_for_delegated(
            method,
            path,
            json=body,
        )


    # ---------------------------------------------------------
    # 5. OWNER can manage settings
    # ---------------------------------------------------------

    owner_settings = await async_client.patch(
        f"/api/projects/{slug}/settings",
        headers=owner_headers,
        json={
            "telemetry_enabled": True,
        },
    )

    assert owner_settings.status_code == 200, (
        owner_settings.text
    )


    owner_delete_column = await async_client.delete(
        f"/api/projects/{slug}/columns/custom",
        headers=owner_headers,
    )

    assert owner_delete_column.status_code == 200, (
        owner_delete_column.text
    )


    # ---------------------------------------------------------
    # 6. OWNER can create/list/revoke access links
    # ---------------------------------------------------------

    owner_created_link = await async_client.post(
        f"/api/projects/{slug}/access-links",
        headers=owner_headers,
        json={
            "label": "Owner-created link",
            "role": "reviewer",
            "ttl": "7d",
            "single_use": False,
        },
    )

    assert owner_created_link.status_code == 200, (
        owner_created_link.text
    )

    owner_created_link_id = (
        owner_created_link.json()["id"]
    )

    owner_list_links = await async_client.get(
        f"/api/projects/{slug}/access-links",
        headers=owner_headers,
    )

    assert owner_list_links.status_code == 200, (
        owner_list_links.text
    )

    listed_ids = {
        item["id"]
        for item in owner_list_links.json()
    }

    assert team_link_id in listed_ids
    assert reviewer_link_id in listed_ids
    assert owner_created_link_id in listed_ids


    owner_delete_link = await async_client.delete(
        (
            f"/api/projects/{slug}/access-links/"
            f"{owner_created_link_id}"
        ),
        headers=owner_headers,
    )

    assert owner_delete_link.status_code == 200, (
        owner_delete_link.text
    )


    # ---------------------------------------------------------
    # 7. OWNER can issue a tunnel
    # ---------------------------------------------------------

    owner_tunnel = await async_client.post(
        f"/api/projects/{slug}/tunnels",
        headers=owner_headers,
        json={
            "target_host": "127.0.0.1",
            "target_port": 5173,
            "ttl": "24h",
            "role": "reviewer",
            "single_use": False,
        },
    )

    assert owner_tunnel.status_code == 200, (
        owner_tunnel.text
    )

    assert owner_tunnel.json().get("tunnel_id")
    assert owner_tunnel.json().get("connector_secret")
    assert owner_tunnel.json().get("preview_url")


    # ---------------------------------------------------------
    # 8. OWNER can access integration-management routes
    #
    # For network-producing operations, 400 is acceptable here:
    # it proves RBAC allowed the request to reach business
    # validation ("GitHub not configured") instead of returning
    # an authorization 403.
    # ---------------------------------------------------------

    owner_github_get = await async_client.get(
        f"/api/projects/{slug}/github",
        headers=owner_headers,
    )

    assert owner_github_get.status_code == 200, (
        owner_github_get.text
    )


    owner_github_save = await async_client.post(
        f"/api/projects/{slug}/github",
        headers=owner_headers,
        json={
            "github_repo": "owner/repo",
            "github_sync_enabled": False,
        },
    )

    assert owner_github_save.status_code == 200, (
        owner_github_save.text
    )


    owner_github_test = await async_client.post(
        f"/api/projects/{slug}/github/test",
        headers=owner_headers,
        json={
            "github_repo": "owner/repo",
            "github_sync_enabled": False,
        },
    )

    assert owner_github_test.status_code != 403, (
        owner_github_test.text
    )


    owner_github_sync = await async_client.post(
        f"/api/projects/{slug}/github/sync",
        headers=owner_headers,
    )

    assert owner_github_sync.status_code != 403, (
        owner_github_sync.text
    )


    owner_single_sync = await async_client.post(
        (
            f"/api/projects/{slug}/tickets/"
            f"{existing_ticket_id}/github/sync"
        ),
        headers=owner_headers,
    )

    assert owner_single_sync.status_code != 403, (
        owner_single_sync.text
    )


    # ---------------------------------------------------------
    # 9. OWNER can delete the project.
    # Do this LAST because the project is needed above.
    # ---------------------------------------------------------

    owner_delete_project = await async_client.delete(
        f"/api/projects/{slug}",
        headers=owner_headers,
        params={
            "confirmation_slug": slug,
        },
    )

    assert owner_delete_project.status_code == 200, (
        owner_delete_project.text
    )

    assert owner_delete_project.json()["deleted"] is True

