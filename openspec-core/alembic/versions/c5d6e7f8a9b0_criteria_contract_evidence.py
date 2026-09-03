"""criteria contract evidence persistence

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, None] = "b4c5d6e7f8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("spec_tickets", schema=None) as batch_op:
        batch_op.add_column(sa.Column("criteria_contract", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
        batch_op.add_column(sa.Column("criteria_evidence", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
        batch_op.add_column(sa.Column("quality_mode", sa.String(length=16), nullable=False, server_default="strict"))
        batch_op.create_check_constraint(
            "ck_spec_tickets_quality_mode",
            "quality_mode IN ('standard', 'strict', 'critical')",
        )


def downgrade() -> None:
    with op.batch_alter_table("spec_tickets", schema=None) as batch_op:
        batch_op.drop_constraint("ck_spec_tickets_quality_mode", type_="check")
        batch_op.drop_column("quality_mode")
        batch_op.drop_column("criteria_evidence")
        batch_op.drop_column("criteria_contract")
