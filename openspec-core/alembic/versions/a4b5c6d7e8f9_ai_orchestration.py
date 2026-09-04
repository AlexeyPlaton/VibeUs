"""add provider-agnostic AI orchestration state

Revision ID: a4b5c6d7e8f9
Revises: f2a3b4c5d6e7
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a4b5c6d7e8f9"
down_revision: Union[str, None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_automation_configs",
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("autonomy_mode", sa.String(length=32), nullable=False, server_default="assisted"),
        sa.Column("agent_kind", sa.String(length=32), nullable=False, server_default="web_ai"),
        sa.Column("dispatch_label", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("auto_issue_sync", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("auto_dispatch_on_handoff", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("create_pr_from_patch", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("observe_ci", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("observe_preview", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("auto_move_to_review", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("max_repair_attempts", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("merge_policy", sa.String(length=32), nullable=False, server_default="human_accept"),
        sa.Column("protected_paths", sa.JSON(), nullable=False),
        sa.Column("github_webhook_secret_encrypted", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id"),
    )
    op.create_table(
        "ticket_automation_states",
        sa.Column("ticket_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False, server_default="web_ai"),
        sa.Column("base_branch", sa.String(length=255), nullable=True),
        sa.Column("base_sha", sa.String(length=64), nullable=True),
        sa.Column("branch_name", sa.String(length=255), nullable=True),
        sa.Column("github_pr_number", sa.Integer(), nullable=True),
        sa.Column("github_pr_url", sa.String(length=1024), nullable=True),
        sa.Column("head_sha", sa.String(length=64), nullable=True),
        sa.Column("ci_state", sa.String(length=32), nullable=False, server_default="not_started"),
        sa.Column("preview_url", sa.String(length=2048), nullable=True),
        sa.Column("orchestration_status", sa.String(length=64), nullable=False, server_default="idle"),
        sa.Column("repair_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_failed_head_sha", sa.String(length=64), nullable=True),
        sa.Column("last_check_summary", sa.JSON(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["ticket_id"], ["spec_tickets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("ticket_id"),
    )
    op.create_index("ix_ticket_automation_states_project_id", "ticket_automation_states", ["project_id"])
    op.create_index("ix_ticket_automation_states_head_sha", "ticket_automation_states", ["head_sha"])


def downgrade() -> None:
    op.drop_index("ix_ticket_automation_states_head_sha", table_name="ticket_automation_states")
    op.drop_index("ix_ticket_automation_states_project_id", table_name="ticket_automation_states")
    op.drop_table("ticket_automation_states")
    op.drop_table("project_automation_configs")
