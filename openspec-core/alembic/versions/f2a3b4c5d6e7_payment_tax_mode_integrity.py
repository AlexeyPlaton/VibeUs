"""snapshot fiscal tax mode per payment

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("payments") as batch_op:
        # Existing installations of this release were operated as NPD. The value
        # is persisted on every payment so a later config switch cannot reinterpret
        # an in-flight or historical payment.
        batch_op.add_column(
            sa.Column("tax_mode", sa.String(length=16), nullable=False, server_default="npd")
        )


def downgrade() -> None:
    with op.batch_alter_table("payments") as batch_op:
        batch_op.drop_column("tax_mode")
