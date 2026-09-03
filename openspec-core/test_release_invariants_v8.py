import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import crud
import models
import schemas
from release_invariants import human_review_transition, install_runtime_invariants


install_runtime_invariants()


def test_done_status_requires_explicit_human_review_context():
    ticket = models.SpecTicket(node_id="node", title="Guarded", status="review")

    with pytest.raises(HTTPException) as exc:
        ticket.status = "done"
    assert exc.value.status_code == 403
    assert "human review" in str(exc.value.detail).lower()

    with human_review_transition():
        ticket.status = "done"
    assert ticket.status == "done"


@pytest.mark.asyncio
async def test_lifetime_solo_still_has_ten_project_limit():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    async with Session() as db:
        workspace = models.Workspace(
            id="ws-lifetime-solo",
            name="Lifetime Solo",
            owner_email="owner@example.com",
            subscription_tier="solo",
            subscription_status="active",
            is_lifetime_free=True,
        )
        db.add(workspace)
        for index in range(10):
            db.add(models.Project(
                id=f"project-{index}",
                workspace_id=workspace.id,
                name=f"Project {index}",
                slug=f"project-{index}",
            ))
        await db.commit()

        with pytest.raises(HTTPException) as exc:
            await crud.create_project(
                db,
                schemas.ProjectCreate(
                    name="Eleventh",
                    slug="eleventh-project",
                    workspace_id=workspace.id,
                ),
                workspace=workspace,
            )
        assert exc.value.status_code == 402
        assert "10" in str(exc.value.detail)

    await engine.dispose()
