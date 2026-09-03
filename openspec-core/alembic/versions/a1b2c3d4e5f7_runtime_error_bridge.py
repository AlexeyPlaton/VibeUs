"""runtime error bridge

Revision ID: a1b2c3d4e5f7
Revises: f0a1b2c3d4e5
Create Date: 2026-09-02
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "a1b2c3d4e5f7"
down_revision: Union[str, Sequence[str], None] = "f0a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(sa.Column("runtime_error_tracking_enabled", sa.Boolean(), server_default=sa.text("1"), nullable=True))
        batch_op.add_column(sa.Column("raw_ingest_key", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("ingest_key_digest", sa.String(length=128), nullable=True))
        batch_op.create_index("ix_projects_ingest_key_digest", ["ingest_key_digest"], unique=True)

    op.create_table(
        "error_groups",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("service", sa.String(length=64), server_default="backend", nullable=False),
        sa.Column("exception_type", sa.String(length=128), nullable=False),
        sa.Column("normalized_message", sa.Text(), nullable=False),
        sa.Column("route", sa.String(length=256), nullable=True),
        sa.Column("top_frame", sa.String(length=256), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="open", nullable=False),
        sa.Column("occurrences_count", sa.Integer(), server_default="1", nullable=False),
        sa.Column("first_seen_at", sa.DateTime(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.Column("ticket_id", sa.String(), sa.ForeignKey("spec_tickets.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("project_id", "fingerprint", name="uq_project_error_fingerprint"),
    )
    op.create_index("ix_error_groups_project_id", "error_groups", ["project_id"])
    op.create_index("ix_error_groups_fingerprint", "error_groups", ["fingerprint"])

    op.create_table(
        "error_occurrences",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("group_id", sa.String(), sa.ForeignKey("error_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("environment", sa.String(length=32), server_default="production", nullable=True),
        sa.Column("release", sa.String(length=64), nullable=True),
        sa.Column("method", sa.String(length=16), nullable=True),
        sa.Column("route", sa.String(length=256), nullable=True),
        sa.Column("status_code", sa.Integer(), server_default="500", nullable=True),
        sa.Column("stack", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_error_occurrences_group_id", "error_occurrences", ["group_id"])
    op.create_index("ix_error_occurrences_request_id", "error_occurrences", ["request_id"])


def downgrade() -> None:
    op.drop_table("error_occurrences")
    op.drop_table("error_groups")
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_index("ix_projects_ingest_key_digest")
        batch_op.drop_column("ingest_key_digest")
        batch_op.drop_column("raw_ingest_key")
        batch_op.drop_column("runtime_error_tracking_enabled")
