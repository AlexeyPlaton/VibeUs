import os
import sqlite3
import subprocess
import sys
from pathlib import Path

from models import Feedback, Project


CORE_DIR = Path(__file__).resolve().parent
C7_REVISION = "c7d8e9f0a1b2"


def _database_url(db_path: Path) -> str:
    resolved = db_path.resolve().as_posix()
    return f"sqlite+aiosqlite:///{resolved}"


def _run_alembic(db_path: Path, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = _database_url(db_path)
    env["ENVIRONMENT"] = "test"
    env["TOKEN_PEPPER"] = (
        "migration-test-pepper-"
        "0123456789abcdef0123456789abcdef"
    )

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            str(CORE_DIR / "alembic.ini"),
            *args,
        ],
        cwd=str(CORE_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )

    assert result.returncode == 0, (
        f"Alembic command failed: {' '.join(args)}\n"
        f"{result.stdout}"
    )


def _columns(db_path: Path, table_name: str) -> set[str]:
    conn = sqlite3.connect(str(db_path))
    try:
        rows = conn.execute(
            f'PRAGMA table_info("{table_name}")'
        ).fetchall()
        return {row[1] for row in rows}
    finally:
        conn.close()


def test_blank_database_upgrade_head_matches_feedback_orm(tmp_path: Path):
    db_path = tmp_path / "blank-to-head.sqlite"

    _run_alembic(db_path, "upgrade", "head")

    actual_columns = _columns(db_path, "feedbacks")
    orm_columns = {
        column.name
        for column in Feedback.__table__.columns
    }

    assert "converted_ticket_id" in actual_columns
    assert orm_columns.issubset(actual_columns), (
        f"Feedback ORM columns missing from migrated DB: "
        f"{sorted(orm_columns - actual_columns)}"
    )

    project_columns = _columns(db_path, "projects")
    project_orm_columns = {column.name for column in Project.__table__.columns}
    assert "ingest_key_digest" in project_columns
    assert "raw_ingest_key" not in project_columns
    assert project_orm_columns.issubset(project_columns)

    promo_columns = _columns(db_path, "promo_codes")
    assert {"duration_days", "grants_lifetime", "campaign"}.issubset(promo_columns)
    redemption_columns = _columns(db_path, "promo_redemptions")
    assert {"promo_code_id", "workspace_id", "campaign", "tier", "duration_days"}.issubset(redemption_columns)
    workspace_columns = _columns(db_path, "workspaces")
    assert {"first_touch_source", "first_touch_at"}.issubset(workspace_columns)
    payment_columns = _columns(db_path, "payments")
    assert {
        "tax_mode",
        "fiscal_status",
        "receipt_url",
        "receipt_issued_at",
        "buyer_email",
        "buyer_is_b2b",
        "buyer_inn",
        "buyer_name",
        "buyer_snapshot_verified",
    }.issubset(payment_columns)
    refund_columns = _columns(db_path, "payment_refunds")
    assert {
        "provider_refund_id",
        "payment_id",
        "amount_minor",
        "currency",
        "status",
    }.issubset(refund_columns)


def test_existing_c7_database_upgrades_forward_without_editing_history(
    tmp_path: Path,
):
    db_path = tmp_path / "c7-to-head.sqlite"

    _run_alembic(db_path, "upgrade", C7_REVISION)

    before = _columns(db_path, "feedbacks")
    assert "converted_ticket_id" not in before, (
        "Historical c7 migration appears to have been modified. "
        "Do not rewrite migration history."
    )

    _run_alembic(db_path, "upgrade", "head")

    after = _columns(db_path, "feedbacks")
    assert "converted_ticket_id" in after

    # Prove downgrade boundary too.
    _run_alembic(db_path, "downgrade", C7_REVISION)

    downgraded = _columns(db_path, "feedbacks")
    assert "converted_ticket_id" not in downgraded


def test_existing_2b_database_upgrades_forward(tmp_path: Path):
    db_path = tmp_path / "2b-to-head.sqlite"
    _run_alembic(db_path, "upgrade", "2b9d4ba2c45d")
    _run_alembic(db_path, "upgrade", "head")
    proj_cols = _columns(db_path, "projects")
    assert "api_token_digest" in proj_cols
    assert "api_token" not in proj_cols

def test_deployed_runtime_bridge_migration_drops_raw_ingest_secret_at_head(tmp_path: Path):
    db_path = tmp_path / "runtime-f7-to-hardening-head.sqlite"

    _run_alembic(db_path, "upgrade", "a1b2c3d4e5f7")
    before = _columns(db_path, "projects")
    assert "raw_ingest_key" in before
    assert "ingest_key_digest" in before

    _run_alembic(db_path, "upgrade", "head")
    hardened = _columns(db_path, "projects")
    assert "raw_ingest_key" not in hardened
    assert "ingest_key_digest" in hardened

    _run_alembic(db_path, "downgrade", "a1b2c3d4e5f7")
    downgraded = _columns(db_path, "projects")
    assert "raw_ingest_key" in downgraded
