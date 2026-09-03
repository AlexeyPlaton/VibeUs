"""legal acceptance ledger

Revision ID: d0e1f2a3b4c5
Revises: c5d6e7f8a9b0
Create Date: 2026-09-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, None] = "c5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "legal_acceptances",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("document_type", sa.String(length=32), nullable=False),
        sa.Column("document_version", sa.String(length=32), nullable=False),
        sa.Column("legal_locale", sa.String(length=2), nullable=False),
        sa.Column("accepted_at", sa.DateTime(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="registration"),
        sa.CheckConstraint(
            "document_type IN ('terms', 'privacy_acknowledgement', 'personal_data_consent')",
            name="ck_legal_acceptances_document_type",
        ),
        sa.CheckConstraint("legal_locale IN ('en', 'ru')", name="ck_legal_acceptances_locale"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "document_type",
            "document_version",
            name="uq_legal_acceptance_user_document_version",
        ),
    )
    op.create_index("ix_legal_acceptances_user_id", "legal_acceptances", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_legal_acceptances_user_id", table_name="legal_acceptances")
    op.drop_table("legal_acceptances")
