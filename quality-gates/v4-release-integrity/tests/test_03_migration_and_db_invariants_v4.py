from __future__ import annotations

import hashlib
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest


PUBLISHED_NORMALIZED_SHA256 = {
    "9bc026dc6e3a_security_and_contracts.py": "ecedffca93d6c76d29f33b6c67c7eed5669f32e246ffed40ece4426531c3b0e1",
    "f0a1b2c3d4e5_account_dashboard_keys.py": "0dc46098c37b9892941759c4a86791ae27791ad126b9407e4ea4471e6662d4dc",
    "e1f2a3b4c5d6_payment_fiscal_status_and_receipts.py": "74d5633dfd12f7d061e89d954c8b5d6b9c6a78b3acceadec80bc42dd32094057",
    "f2a3b4c5d6e7_payment_tax_mode_integrity.py": "124f62b3512efb1d232a7e2de27657a1c9205335642c94909d60058017e1c194",
}


def _normalized_sha(path: Path) -> str:
    text = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _run_alembic(core_dir: Path, db_path: Path, *args: str) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_path.resolve().as_posix()}"
    env["ENVIRONMENT"] = "test"
    env["TOKEN_PEPPER"] = "qgv4-migration-pepper-0123456789abcdef0123456789"
    env["FIELD_ENCRYPTION_KEY"] = "qgv4-migration-field-0123456789abcdef0123456789"
    return subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(core_dir / "alembic.ini"), *args],
        cwd=str(core_dir),
        env=env,
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )


@pytest.mark.blocker
@pytest.mark.migration
def test_published_migrations_are_not_rewritten(core_dir: Path):
    versions = core_dir / "alembic" / "versions"
    for name, expected in PUBLISHED_NORMALIZED_SHA256.items():
        path = versions / name
        assert path.exists(), f"Published migration disappeared: {name}"
        assert _normalized_sha(path) == expected, (
            f"Published migration {name} was edited. Restore it and add a NEW forward migration instead."
        )


@pytest.fixture
def migrated_db(core_dir: Path, tmp_path: Path) -> Path:
    db_path = tmp_path / "v4-head.sqlite"
    proc = _run_alembic(core_dir, db_path, "upgrade", "head")
    assert proc.returncode == 0, f"alembic upgrade head failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
    heads = _run_alembic(core_dir, db_path, "heads")
    assert heads.returncode == 0, heads.stderr
    head_lines = [line for line in heads.stdout.splitlines() if "(head)" in line]
    assert len(head_lines) == 1, f"Expected exactly one Alembic head, got: {head_lines or heads.stdout}"
    return db_path


@pytest.mark.blocker
@pytest.mark.migration
def test_payment_buyer_snapshot_columns_exist_in_real_migrated_schema(migrated_db: Path):
    with sqlite3.connect(migrated_db) as conn:
        cols = {row[1] for row in conn.execute('PRAGMA table_info("payments")')}
    required = {"buyer_email", "buyer_is_b2b", "buyer_inn", "buyer_name"}
    assert required.issubset(cols), f"Missing durable Payment buyer snapshot columns: {sorted(required - cols)}"


def _insert_payment(conn: sqlite3.Connection, suffix: str, **overrides):
    values = {
        "id": f"pay-{suffix}",
        "provider": "yookassa",
        "provider_payment_id": f"yk-{suffix}",
        "workspace_id": "ws-not-needed-for-check-test",
        "plan": "solo",
        "amount_minor": 149000,
        "currency": "RUB",
        "status": "pending",
        "is_test": 0,
        "tax_mode": "npd",
        "fiscal_status": "receipt_not_required",
        "receipt_url": None,
        "receipt_issued_at": None,
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
    pytest.fail(f"Database accepted an invalid fiscal Payment state: {overrides}")


@pytest.mark.blocker
@pytest.mark.migration
def test_database_enforces_fiscal_state_machine_not_only_python_convention(migrated_db: Path):
    with sqlite3.connect(migrated_db) as conn:
        _must_reject(conn, "bad-tax", tax_mode="whatever")
        _must_reject(conn, "bad-fiscal", fiscal_status="whatever")
        _must_reject(conn, "premature-required", status="pending", tax_mode="npd", fiscal_status="receipt_required")
        _must_reject(conn, "kkt-required", status="succeeded", tax_mode="kkt_54fz", fiscal_status="receipt_required")
        _must_reject(conn, "issued-without-proof", status="succeeded", tax_mode="npd", fiscal_status="receipt_issued")

        # Positive controls: the gate must not force an impossible state machine.
        _insert_payment(conn, "valid-pending", status="pending", tax_mode="npd", fiscal_status="receipt_not_required")
        _insert_payment(conn, "valid-required", status="succeeded", tax_mode="npd", fiscal_status="receipt_required")
        _insert_payment(
            conn,
            "valid-issued",
            status="succeeded",
            tax_mode="npd",
            fiscal_status="receipt_issued",
            receipt_url="https://lknpd.nalog.ru/api/v1/receipt/example/print",
            receipt_issued_at="2026-09-02 12:00:00",
        )
        _insert_payment(conn, "valid-kkt", status="succeeded", tax_mode="kkt_54fz", fiscal_status="receipt_not_required")
        conn.commit()
