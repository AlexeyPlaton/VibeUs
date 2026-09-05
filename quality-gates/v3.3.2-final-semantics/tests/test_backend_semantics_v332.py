import re
import pytest
from pathlib import Path
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from conftest import read_text, function_block, class_block


def effective_main_source(project_root: Path) -> str:
    """Return the production FastAPI surface after the main/main_legacy split.

    ``main.py`` is now the release-invariant wrapper while the historical route
    implementations remain in ``main_legacy.py`` and are imported into the same
    FastAPI application. Final-semantics source checks must inspect both files or
    they can report missing WebSocket/MCP/tunnel behavior that is live at runtime.
    """
    core = project_root / 'openspec-core'
    return read_text(core / 'main.py') + '\n\n' + read_text(core / 'main_legacy.py')


async def _fresh_db(core_modules):
    models = core_modules['models']
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    return engine, Session


async def _seed(Session, core_modules, *, with_discussion=False, with_feedback=False):
    models = core_modules['models']
    async with Session() as db:
        ws = models.Workspace(
            id='ws_v332', name='Gate', owner_email='gate@example.test',
            subscription_tier='solo', tickets_used_this_month=0,
        )
        project = models.Project(
            id='p_v332', workspace_id='ws_v332', name='Gate Project', slug='gate-project',
            ticket_seq=0, revision=0, columns=[{'id': 'backlog', 'label': 'Backlog'}],
        )
        discussions = []
        if with_discussion:
            discussions = [{
                'id': 'disc_v332', 'quote': 'selected quote', 'text': 'discussion text',
                'author': 'client', 'comments': [], 'status': 'open', 'resolved': False,
                'created_ticket_ids': []
            }]
        node = models.SpecNode(
            id='node_v332', project_id='p_v332', title='General',
            description='', content_markdown='', discussions=discussions, is_deleted=False,
        )
        db.add_all([ws, project, node])
        if with_feedback:
            db.add(models.Feedback(
                id='fb_v332', project_id='p_v332', text='feedback text',
                category='idea', status='new', details={}
            ))
        await db.commit()
    return 'p_v332', 'node_v332'


@pytest.mark.asyncio
async def test_01_create_ticket_no_commit_materializes_id(core_modules):
    """commit=False must still flush so ticket.id exists inside the outer transaction."""
    models, schemas, crud = core_modules['models'], core_modules['schemas'], core_modules['crud']
    engine, Session = await _fresh_db(core_modules)
    try:
        project_id, node_id = await _seed(Session, core_modules)
        async with Session() as db:
            ticket = await crud.create_ticket(
                db, project_id, node_id,
                schemas.TicketCreate(title='flush contract'),
                commit=False,
            )
            assert ticket.id, 'create_ticket(commit=False) returned a ticket without a materialized primary key; await db.flush() is required'
            q = await db.execute(select(models.SpecTicket).where(models.SpecTicket.id == ticket.id))
            assert q.scalar_one_or_none() is ticket, 'The no-commit ticket must be flushed/visible in the current transaction'
            await db.rollback()
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_02_feedback_conversion_idempotent_linkage_and_single_revision(core_modules):
    models, schemas, crud = core_modules['models'], core_modules['schemas'], core_modules['crud']
    engine, Session = await _fresh_db(core_modules)
    try:
        project_id, node_id = await _seed(Session, core_modules, with_feedback=True)
        data = schemas.FeedbackConvertToTicket(node_id=node_id, title='From feedback', priority='medium', summary='summary')
        async with Session() as db:
            first = await crud.convert_feedback_to_ticket(db, project_id, 'fb_v332', data)
            first_id = first['ticket']['id']
            assert first_id, 'First feedback conversion returned empty ticket id'
            fb = (await db.execute(select(models.Feedback).where(models.Feedback.id == 'fb_v332'))).scalar_one()
            assert fb.converted_ticket_id == first_id, 'feedback.converted_ticket_id must equal the committed ticket id'
            count = (await db.execute(select(func.count(models.SpecTicket.id)))).scalar_one()
            assert count == 1
            project = (await db.execute(select(models.Project).where(models.Project.id == project_id))).scalar_one()
            assert (project.revision or 0) == 1, 'One logical feedback conversion must increment project.revision exactly once'

            second = await crud.convert_feedback_to_ticket(db, project_id, 'fb_v332', data)
            assert second['ticket']['id'] == first_id, 'Repeated feedback conversion must return the original ticket'
            count2 = (await db.execute(select(func.count(models.SpecTicket.id)))).scalar_one()
            assert count2 == 1, 'Repeated feedback conversion created a duplicate ticket'
            await db.refresh(project)
            assert (project.revision or 0) == 1, 'Idempotent repeat must not increment project.revision'
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_03_discussion_conversion_idempotent_linkage_and_single_revision(core_modules):
    models, schemas, crud = core_modules['models'], core_modules['schemas'], core_modules['crud']
    engine, Session = await _fresh_db(core_modules)
    try:
        project_id, node_id = await _seed(Session, core_modules, with_discussion=True)
        data = schemas.DiscussionConvertToTicket(title='From discussion', priority='high', summary='summary')
        async with Session() as db:
            first = await crud.convert_discussion_to_ticket(db, project_id, node_id, 'disc_v332', data)
            first_id = first['ticket']['id']
            assert first_id
            node = (await db.execute(select(models.SpecNode).where(models.SpecNode.id == node_id))).scalar_one()
            await db.refresh(node)
            disc = next(d for d in (node.discussions or []) if d.get('id') == 'disc_v332')
            assert disc.get('created_ticket_ids') == [first_id], 'discussion.created_ticket_ids must contain the real committed ticket id, not null/temp id'
            count = (await db.execute(select(func.count(models.SpecTicket.id)))).scalar_one()
            assert count == 1
            project = (await db.execute(select(models.Project).where(models.Project.id == project_id))).scalar_one()
            assert (project.revision or 0) == 1, 'One logical discussion conversion must increment project.revision exactly once'

            second = await crud.convert_discussion_to_ticket(db, project_id, node_id, 'disc_v332', data)
            assert second['ticket']['id'] == first_id
            count2 = (await db.execute(select(func.count(models.SpecTicket.id)))).scalar_one()
            assert count2 == 1, 'Repeated discussion conversion created a duplicate ticket'
            await db.refresh(project)
            assert (project.revision or 0) == 1
    finally:
        await engine.dispose()


def test_04_ws_ticket_mutations_advance_ticket_revision(project_root: Path):
    src = effective_main_source(project_root)
    start = src.find("@app.websocket('/ws/sync/{project_slug}')")
    if start < 0:
        start = src.find('async def websocket_endpoint')
    assert start >= 0, 'Missing WS sync endpoint'
    end = src.find("@app.post('/api/projects/{slug}/tunnels')", start)
    block = src[start:end if end > start else len(src)]
    marker = 'proj.revision = curr_rev + 1'
    assert marker in block, 'WS mutation path must advance project revision'
    common_tail = block[block.rfind("elif ev_type == \"ticket.checklist.change\""):block.find(marker)+len(marker)]
    # A common increment after all three branches is preferred. Branch-local increments are also accepted.
    common_increment = re.search(r'ticket\.revision\s*=\s*\(ticket\.revision\s+or\s+0\)\s*\+\s*1', block)
    branch_increments = len(re.findall(r'ticket\.revision\s*=.*\+\s*1', block)) >= 3
    assert common_increment or branch_increments, (
        'Every successful WS status/comment/checklist mutation must increment SpecTicket.revision in the same transaction; '
        'otherwise stale REST If-Match can overwrite WS changes'
    )


def test_05_duplicate_ws_ack_carries_authoritative_revision(project_root: Path):
    src = effective_main_source(project_root)
    matches = list(re.finditer(r'await\s+websocket\.send_json\(\{(?P<body>[\s\S]{0,700}?\"duplicate\"\s*:\s*True[\s\S]{0,700}?)\}\)', src))
    assert matches, 'Missing duplicate WS idempotency ACK path'
    body = matches[0].group('body')
    assert re.search(r'[\"\']revision[\"\']\s*:', body), (
        'Duplicate event.ack must include authoritative project revision in the same JSON envelope for reconnect retries'
    )


def test_06_feature_flags_actually_gate_risky_routes(project_root: Path):
    src = effective_main_source(project_root)
    mcp = function_block(src, 'async def execute_mcp_tool(')
    tunnel = function_block(src, 'async def create_tunnel_session(')
    assert 'enable_mcp_write' in mcp, 'ENABLE_MCP_WRITE is validated in settings but execute_mcp_tool does not enforce it'
    assert ('write_tools' in mcp and ('403' in mcp or '404' in mcp or 'disabled' in mcp.lower())), 'MCP write flag must fail closed for write/integration tools'
    assert 'enable_public_tunnels' in tunnel, 'ENABLE_PUBLIC_TUNNELS must be enforced by the tunnel issuance endpoint, not only config validation'
    assert ('403' in tunnel or '404' in tunnel or 'disabled' in tunnel.lower()), 'Disabled public tunnels must fail closed'


def test_07_tunnel_forever_is_not_silently_seven_days(project_root: Path):
    main = effective_main_source(project_root)
    models = read_text(project_root/'openspec-core'/'models.py')
    block = function_block(main, 'async def create_tunnel_session(')
    # Accept either explicit rejection of forever for live tunnels, or true nullable/no-expiry semantics.
    rejects_forever = bool(re.search(r'if\s+.*ttl.*[=!]=?\s*[\'\"]forever[\'\"][\s\S]{0,300}?raise\s+HTTPException', block))
    if rejects_forever:
        return
    tunnel_model = class_block(models, 'class TunnelSession(')
    nullable_expiry = bool(re.search(r'expires_at\s*=\s*Column\([^\n]*nullable\s*=\s*True', tunnel_model))
    no_7d_fallback = not re.search(r'access_link\.expires_at\s+or\s+\([^\n]*timedelta\(days\s*=\s*7', block)
    safe_return = ('expires_at.isoformat() if expires_at else None' in block or 'expires_at and expires_at.isoformat()' in block or 'None if expires_at is None' in block)
    assert nullable_expiry and no_7d_fallback and safe_return, (
        'ttl=forever must either be explicitly rejected for live tunnels or represented as a true non-expiring TunnelSession; '
        'silently converting forever to 7 days is forbidden'
    )


def test_08_ticket_created_side_effects_are_consistent_after_conversion(project_root: Path):
    src = read_text(project_root/'openspec-core'/'crud.py')
    feedback = function_block(src, 'async def convert_feedback_to_ticket(')
    discussion = function_block(src, 'async def convert_discussion_to_ticket(')
    # We require a shared post-commit hook so ordinary create and atomic conversions cannot silently diverge.
    hook_names = re.findall(r'async def\s+([A-Za-z0-9_]*ticket[A-Za-z0-9_]*(?:side_effect|post_commit|created)[A-Za-z0-9_]*)\s*\(', src, re.I)
    assert hook_names, 'Introduce one shared post-commit ticket-created side-effect helper for Telegram/GitHub notifications/sync'
    hook = hook_names[0]
    create = function_block(src, 'async def create_ticket(')
    assert hook in create, 'Normal ticket creation must use the shared post-commit side-effect helper'
    assert hook in feedback, 'Feedback conversion must run the same ticket-created side effects after its successful outer commit'
    assert hook in discussion, 'Discussion conversion must run the same ticket-created side effects after its successful outer commit'
