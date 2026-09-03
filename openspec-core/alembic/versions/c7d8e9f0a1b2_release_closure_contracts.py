"""release closure contracts backfill workspace key feedbacks and usage period

Revision ID: c7d8e9f0a1b2
Revises: a1b2c3d4e5f6
Create Date: 2026-08-30 23:45:00.000000

"""
import os
import hmac
import hashlib
from alembic import op
import sqlalchemy as sa

revision = 'c7d8e9f0a1b2'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None

def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    
    # 1. Backfill api_key_digest if api_key column exists
    workspace_cols = [c['name'] for c in insp.get_columns('workspaces')]
    if 'api_key' in workspace_cols:
        pepper = os.getenv('TOKEN_PEPPER', 'dev-pepper-do-not-use-in-prod-0123456789')
        rows = bind.execute(sa.text("SELECT id, api_key, api_key_digest FROM workspaces")).fetchall()
        for row in rows:
            r_id = row[0]
            raw_key = row[1]
            curr_digest = row[2]
            if raw_key and not curr_digest:
                new_digest = hmac.new(pepper.encode('utf-8'), raw_key.encode('utf-8'), hashlib.sha256).hexdigest()
                bind.execute(
                    sa.text("UPDATE workspaces SET api_key_digest = :d WHERE id = :i"),
                    {"d": new_digest, "i": r_id}
                )

    # 2. Alter workspaces
    with op.batch_alter_table('workspaces') as batch_op:
        if 'yookassa_payment_method_id' not in workspace_cols:
            batch_op.add_column(sa.Column('yookassa_payment_method_id', sa.String(length=256), nullable=True))
        if 'tickets_usage_period_start' not in workspace_cols:
            batch_op.add_column(sa.Column('tickets_usage_period_start', sa.DateTime(), nullable=True))
        if 'api_key' in workspace_cols:
            batch_op.drop_column('api_key')

    # 3. Create feedbacks table if not exists
    tables = insp.get_table_names()
    if 'feedbacks' not in tables:
        op.create_table(
            'feedbacks',
            sa.Column('id', sa.String(), primary_key=True),
            sa.Column('project_id', sa.String(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
            sa.Column('idempotency_key', sa.String(length=128), nullable=True),
            sa.Column('text', sa.Text(), nullable=False),
            sa.Column('category', sa.String(length=64), nullable=True),
            sa.Column('status', sa.String(length=32), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('details', sa.JSON(), nullable=True),
            sa.UniqueConstraint('project_id', 'idempotency_key', name='uq_feedbacks_project_idempotency')
        )
        with op.batch_alter_table('feedbacks') as batch_op:
            batch_op.create_index('ix_feedbacks_project_id', ['project_id'])

def downgrade() -> None:
    op.drop_table('feedbacks')
    with op.batch_alter_table('workspaces') as batch_op:
        batch_op.add_column(sa.Column('api_key', sa.String(), nullable=True))
        batch_op.drop_column('tickets_usage_period_start')
        batch_op.drop_column('yookassa_payment_method_id')
