"""payment fiscal status and npd receipt tracking

Revision ID: e1f2a3b4c5d6
Revises: d9e0f1a2b3c4
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, Sequence[str], None] = "d9e0f1a2b3c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("payments") as batch_op:
        batch_op.add_column(sa.Column("fiscal_status", sa.String(length=32), nullable=False, server_default="receipt_not_required"))
        batch_op.add_column(sa.Column("receipt_url", sa.String(length=512), nullable=True))
        batch_op.add_column(sa.Column("receipt_issued_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("payments") as batch_op:
        batch_op.drop_column("receipt_issued_at")
        batch_op.drop_column("receipt_url")
        batch_op.drop_column("fiscal_status")
