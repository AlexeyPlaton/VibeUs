from __future__ import annotations

import hashlib
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest


A3_NAME = "a3b4c5d6e7f8_payment_buyer_snapshot_and_check_constraints.py"
A3_SHA = "45f6d9c5b274b887f2aa466c45d5d2fb6f366d7e6915ea4e9100d8640a0f2734"
A3_REVISION = "a3b4c5d6e7f8"


def _normalized_sha(path: Path) -> str:
    text = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _run_alembic(core_dir: Path, db_path: Path, *args: str):
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_path.resolve().as_posix()}"
    env["ENVIRONMENT"] = "test"
    env["TOKEN_PEPPER"] = "qgv5-migration-pepper-0123456789abcdef0123456789"
    env["FIELD_ENCRYPTION_KEY"] = "qgv5-migration-field-0123456789abcdef0123456789"
    return subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(core_dir / "alembic.ini"), *args],
        cwd=core_dir,
        env=env,
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )


@pytest.mark.blocker
@pytest.mark.migration
def test_v4_a3_migration_is_now_frozen(core_dir: Path):
    p = core_dir / "alembic" / "versions" / A3_NAME
    assert p.exists()
    assert _normalized_sha(p) == A3_SHA, (
        "a3b4c5d6e7f8 was already shipped/reviewed in V4. Do not rewrite it; add a forward migration."
    )


@pytest.mark.blocker
@pytest.mark.migration
def test_v5_uses_a_new_forward_revision_after_a3(core_dir: Path, tmp_path: Path):
    proc = _run_alembic(core_dir, tmp_path / "unused.sqlite", "heads")
    assert proc.returncode == 0, proc.stderr
    heads = [line.strip() for line in proc.stdout.splitlines() if "(head)" in line]
    assert len(heads) == 1, f"Expected one head, got: {heads or proc.stdout}"
    assert not heads[0].startswith(A3_REVISION), "V5 must append a new revision; a3 cannot remain head."


@pytest.fixture
def migrated_db(core_dir: Path, tmp_path: Path) -> Path:
    db = tmp_path / "v5-head.sqlite"
    proc = _run_alembic(core_dir, db, "upgrade", "head")
    assert proc.returncode == 0, f"upgrade head failed:\n{proc.stdout}\n{proc.stderr}"
    return db


def _insert_payment(conn: sqlite3.Connection, suffix: str, **overrides):
    values = {
        "id": f"pay-{suffix}",
        "provider": "yookassa",
        "provider_payment_id": f"yk-{suffix}",
        "workspace_id": "ws-v5",
        "plan": "solo",
        "amount_minor": 149000,
        "currency": "RUB",
        "status": "pending",
        "is_test": 0,
        "tax_mode": "npd",
        "fiscal_status": "receipt_not_required",
        "receipt_url": None,
        "receipt_issued_at": None,
        "buyer_email": "buyer@example.test",
        "buyer_is_b2b": 0,
        "buyer_inn": None,
        "buyer_name": None,
        "buyer_snapshot_verified": 1,
    }
    values.update(overrides)
    cols = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    conn.execute(f"INSERT INTO payments ({cols}) VALUES ({marks})", tuple(values.values()))


def _must_reject(conn: sqlite3.Connection, suffix: str, **overrides):
    try:
        _insert_payment(conn, suffix, **overrides)
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()
        return
    conn.rollback()
    pytest.fail(f"Database accepted invalid Payment state: {overrides}")


@pytest.mark.blocker
@pytest.mark.fiscal
@pytest.mark.migration
def test_database_enforces_complete_issued_and_verified_buyer_invariants(migrated_db: Path):
    with sqlite3.connect(migrated_db) as conn:
        cols = {row[1] for row in conn.execute('PRAGMA table_info("payments")')}
        assert "buyer_snapshot_verified" in cols, "V5 migration must add buyer_snapshot_verified to real schema."
        conn.execute("INSERT INTO workspaces (id, name, owner_email) VALUES ('ws-v5', 'WS', 'owner@example.test')")
        conn.commit()

        proof = {
            "receipt_url": "https://lknpd.nalog.ru/api/v1/receipt/example/print",
            "receipt_issued_at": "2026-09-02 12:00:00",
        }
        _must_reject(
            conn, "pending-issued", status="pending", tax_mode="npd", fiscal_status="receipt_issued", **proof
        )
        _must_reject(
            conn, "kkt-issued", status="succeeded", tax_mode="kkt_54fz", fiscal_status="receipt_issued", **proof
        )
        _must_reject(
            conn, "pending-refund-required", status="pending", tax_mode="npd", fiscal_status="receipt_refund_required", **proof
        )
        _must_reject(
            conn, "kkt-refund-required", status="succeeded", tax_mode="kkt_54fz", fiscal_status="receipt_refund_required", **proof
        )
        _must_reject(
            conn, "verified-no-email", buyer_email=None, buyer_snapshot_verified=1
        )
        _must_reject(
            conn,
            "verified-b2b-no-inn",
            buyer_snapshot_verified=1,
            buyer_is_b2b=1,
            buyer_inn=None,
            buyer_name='ООО "Buyer"',
        )
        _must_reject(
            conn,
            "verified-b2b-no-name",
            buyer_snapshot_verified=1,
            buyer_is_b2b=1,
            buyer_inn="7701234567",
            buyer_name="   ",
        )

        _insert_payment(conn, "valid-pending")
        _insert_payment(conn, "valid-required", status="succeeded", fiscal_status="receipt_required")
        _insert_payment(
            conn,
            "valid-issued",
            status="succeeded",
            fiscal_status="receipt_issued",
            **proof,
        )
        _insert_payment(
            conn,
            "valid-b2b",
            buyer_is_b2b=1,
            buyer_inn="7701234567",
            buyer_name='ООО "Buyer"',
        )
        _insert_payment(
            conn,
            "valid-partial-refund-fiscal",
            status="succeeded",
            tax_mode="npd",
            fiscal_status="receipt_refund_required",
            **proof,
        )
        _insert_payment(
            conn,
            "valid-full-refund-fiscal",
            status="refunded",
            tax_mode="npd",
            fiscal_status="receipt_refund_required",
            **proof,
        )
        conn.commit()


@pytest.mark.blocker
@pytest.mark.migration
def test_refund_ledger_exists_in_real_migrated_schema(migrated_db: Path):
    with sqlite3.connect(migrated_db) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "payment_refunds" in tables, "PaymentRefund ORM without a forward migration is not a production ledger."
        cols = {row[1] for row in conn.execute('PRAGMA table_info("payment_refunds")')}
        required = {"provider_refund_id", "payment_id", "amount_minor", "currency", "status"}
        assert required.issubset(cols), f"payment_refunds missing: {sorted(required - cols)}"
        unique_indexes = []
        for idx in conn.execute('PRAGMA index_list("payment_refunds")'):
            if idx[2]:
                unique_indexes.append({r[2] for r in conn.execute(f'PRAGMA index_info("{idx[1]}")')})
        assert {"provider_refund_id"} in unique_indexes, "provider_refund_id must be unique in the migrated DB."


@pytest.mark.blocker
@pytest.mark.migration
def test_pre_v5_rows_upgrade_as_unverified_not_fake_history(core_dir: Path, tmp_path: Path):
    db = tmp_path / "v5-legacy.sqlite"
    pre = _run_alembic(core_dir, db, "upgrade", A3_REVISION)
    assert pre.returncode == 0, f"upgrade a3 failed:\n{pre.stdout}\n{pre.stderr}"

    with sqlite3.connect(db) as conn:
        conn.execute(
            "INSERT INTO workspaces (id, name, owner_email) VALUES (?, ?, ?)",
            ("ws-legacy-v5", "Legacy", "legacy-owner@example.test"),
        )
        conn.execute(
            "INSERT INTO payments "
            "(id, provider, provider_payment_id, workspace_id, plan, amount_minor, currency, status, is_test, tax_mode, fiscal_status, buyer_is_b2b) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "pay-legacy-v5", "yookassa", "yk-legacy-v5", "ws-legacy-v5", "solo", 149000, "RUB",
                "succeeded", 0, "npd", "receipt_required", 0,
            ),
        )
        conn.commit()

    up = _run_alembic(core_dir, db, "upgrade", "head")
    assert up.returncode == 0, f"a3 -> head failed:\n{up.stdout}\n{up.stderr}"

    with sqlite3.connect(db) as conn:
        row = conn.execute(
            "SELECT buyer_email, buyer_snapshot_verified FROM payments WHERE id='pay-legacy-v5'"
        ).fetchone()
    assert row is not None
    buyer_email, verified = row
    if buyer_email is not None:
        assert buyer_email == "legacy-owner@example.test", "Only the historical workspace owner email is a safe best-effort email backfill."
    assert int(bool(verified)) == 0, "Legacy rows must require explicit operator reconciliation before issuing a new NPD receipt."
