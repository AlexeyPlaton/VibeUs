"""hardcore contracts unique event_id and api_key_digest

Revision ID: a1b2c3d4e5f6
Revises: 9bc026dc6e3a
Create Date: 2026-08-30 20:25:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = '9bc026dc6e3a'
branch_labels = None
depends_on = None

def upgrade() -> None:
    with op.batch_alter_table('audit_events') as batch_op:
        batch_op.add_column(sa.Column('event_id', sa.String(length=128), nullable=True))
        batch_op.create_unique_constraint('uq_audit_events_event_id', ['event_id'])
    with op.batch_alter_table('workspaces') as batch_op:
        batch_op.add_column(sa.Column('api_key_digest', sa.String(length=256), nullable=True))
        batch_op.create_unique_constraint('uq_workspaces_api_key_digest', ['api_key_digest'])

def downgrade() -> None:
    with op.batch_alter_table('workspaces') as batch_op:
        batch_op.drop_constraint('uq_workspaces_api_key_digest', type_='unique')
        batch_op.drop_column('api_key_digest')
    with op.batch_alter_table('audit_events') as batch_op:
        batch_op.drop_constraint('uq_audit_events_event_id', type_='unique')
        batch_op.drop_column('event_id')