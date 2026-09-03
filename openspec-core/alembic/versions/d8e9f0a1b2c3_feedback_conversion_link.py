"""add feedback converted ticket linkage

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-08-31
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d8e9f0a1b2c3"
down_revision: Union[str, Sequence[str], None] = "c7d8e9f0a1b2"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {
        column["name"]
        for column in inspector.get_columns(table_name)
    }


def upgrade() -> None:
    if not _has_column("feedbacks", "converted_ticket_id"):
        with op.batch_alter_table("feedbacks") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "converted_ticket_id",
                    sa.String(),
                    nullable=True,
                )
            )


def downgrade() -> None:
    if _has_column("feedbacks", "converted_ticket_id"):
        with op.batch_alter_table("feedbacks") as batch_op:
            batch_op.drop_column("converted_ticket_id")
