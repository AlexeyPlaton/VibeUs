"""runtime ingest secret hardening

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f7
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing deployed keys continue to validate through ingest_key_digest.
    # Dropping the raw column intentionally makes the credential non-recoverable.
    op.execute(sa.text("UPDATE projects SET runtime_error_tracking_enabled = 0 WHERE runtime_error_tracking_enabled IS NULL"))
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("raw_ingest_key")
        batch_op.alter_column(
            "runtime_error_tracking_enabled",
            existing_type=sa.Boolean(),
            server_default=sa.text("0"),
            existing_nullable=True,
            nullable=False,
        )


def downgrade() -> None:
    # Raw historical secrets cannot and must not be reconstructed from digests.
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(sa.Column("raw_ingest_key", sa.String(length=128), nullable=True))
        batch_op.alter_column(
            "runtime_error_tracking_enabled",
            existing_type=sa.Boolean(),
            server_default=sa.text("1"),
            existing_nullable=False,
            nullable=True,
        )
