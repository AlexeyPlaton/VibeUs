"""Add per-project preview provider configuration.

Revision ID: a5b6c7d8e9f0
Revises: a4b5c6d7e8f9
"""
from alembic import op
import sqlalchemy as sa

revision = "a5b6c7d8e9f0"
down_revision = "a4b5c6d7e8f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_preview_configs",
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False, server_default="github"),
        sa.Column("provider_project_id", sa.String(length=255), nullable=True),
        sa.Column("provider_scope_id", sa.String(length=255), nullable=True),
        sa.Column("review_url", sa.String(length=2048), nullable=True),
        sa.Column("api_token_encrypted", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id"),
    )


def downgrade() -> None:
    op.drop_table("project_preview_configs")
