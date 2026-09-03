"""release security entitlements

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "e9f0a1b2c3d4"
down_revision: Union[str, Sequence[str], None] = "d8e9f0a1b2c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("terms_version", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("terms_accepted_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("privacy_version", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("privacy_acknowledged_at", sa.DateTime(), nullable=True))

    with op.batch_alter_table("workspaces") as batch_op:
        batch_op.add_column(sa.Column("subscription_status", sa.String(), nullable=True, server_default="inactive"))
        batch_op.add_column(sa.Column("current_period_start", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("current_period_end", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("cancel_at_period_end", sa.Boolean(), nullable=True, server_default=sa.false()))

    with op.batch_alter_table("payments") as batch_op:
        batch_op.add_column(sa.Column("entitlement_period_start", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("entitlement_period_end", sa.DateTime(), nullable=True))

    op.create_table(
        "preview_sessions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("session_digest", sa.String(), nullable=False),
        sa.Column("tunnel_id", sa.String(), nullable=False),
        sa.Column("access_link_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["tunnel_id"], ["tunnel_sessions.tunnel_id"]),
        sa.ForeignKeyConstraint(["access_link_id"], ["project_access_links.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_preview_sessions_session_digest", "preview_sessions", ["session_digest"], unique=True)
    op.create_index("ix_preview_sessions_tunnel_id", "preview_sessions", ["tunnel_id"], unique=False)
    op.create_index("ix_preview_sessions_access_link_id", "preview_sessions", ["access_link_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_preview_sessions_access_link_id", table_name="preview_sessions")
    op.drop_index("ix_preview_sessions_tunnel_id", table_name="preview_sessions")
    op.drop_index("ix_preview_sessions_session_digest", table_name="preview_sessions")
    op.drop_table("preview_sessions")

    with op.batch_alter_table("payments") as batch_op:
        batch_op.drop_column("entitlement_period_end")
        batch_op.drop_column("entitlement_period_start")

    with op.batch_alter_table("workspaces") as batch_op:
        batch_op.drop_column("cancel_at_period_end")
        batch_op.drop_column("current_period_end")
        batch_op.drop_column("current_period_start")
        batch_op.drop_column("subscription_status")

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("privacy_acknowledged_at")
        batch_op.drop_column("privacy_version")
        batch_op.drop_column("terms_accepted_at")
        batch_op.drop_column("terms_version")
