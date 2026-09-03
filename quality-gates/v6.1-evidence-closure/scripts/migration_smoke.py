from __future__ import annotations
import importlib.util
import sqlite3
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from alembic.migration import MigrationContext
from alembic.operations import Operations

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
revision_path = root / 'openspec-core/alembic/versions/c5d6e7f8a9b0_criteria_contract_evidence.py'
engine = create_engine('sqlite:///:memory:')
with engine.begin() as conn:
    conn.execute(text("CREATE TABLE spec_tickets (id VARCHAR PRIMARY KEY, checklists JSON NOT NULL DEFAULT '{}' )"))
    context = MigrationContext.configure(conn)
    operations = Operations(context)
    spec = importlib.util.spec_from_file_location('vibus_v61_revision', revision_path)
    if spec is None or spec.loader is None:
        raise RuntimeError('cannot load migration')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.op = operations
    module.upgrade()
    columns = {c['name']: c for c in inspect(conn).get_columns('spec_tickets')}
    required = {'criteria_contract', 'criteria_evidence', 'quality_mode'}
    missing = required - set(columns)
    if missing:
        raise SystemExit(f'MIGRATION SMOKE FAIL missing={sorted(missing)}')
    conn.execute(text("INSERT INTO spec_tickets (id) VALUES ('t1')"))
    row = conn.execute(text("SELECT criteria_contract, criteria_evidence, quality_mode FROM spec_tickets WHERE id='t1'" )).one()
    if row[0] not in ('{}', {}) or row[1] not in ('{}', {}) or row[2] != 'strict':
        raise SystemExit(f'MIGRATION SMOKE FAIL defaults={row!r}')
print('V6.1 MIGRATION SMOKE: PASS')
