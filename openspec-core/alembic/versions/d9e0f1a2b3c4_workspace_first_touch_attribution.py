"""workspace first touch attribution

Revision ID: d9e0f1a2b3c4
Revises: c3d4e5f6a7b8
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d9e0f1a2b3c4"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("workspaces") as batch_op:
        batch_op.add_column(sa.Column("first_touch_source", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("first_touch_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("workspaces") as batch_op:
        batch_op.drop_column("first_touch_at")
        batch_op.drop_column("first_touch_source")
