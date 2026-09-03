"""commercial pricing promos

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, Sequence[str], None] = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("promo_codes") as batch_op:
        batch_op.add_column(sa.Column("duration_days", sa.Integer(), nullable=True, server_default="30"))
        batch_op.add_column(sa.Column("grants_lifetime", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("campaign", sa.String(length=80), nullable=True))
        batch_op.create_index("ix_promo_codes_campaign", ["campaign"], unique=False)

    # Before this migration every promo code granted lifetime access. Preserve
    # existing production semantics; newly created codes default to 30 days.
    op.execute("UPDATE promo_codes SET grants_lifetime = TRUE, duration_days = NULL")

    op.create_table(
        "promo_redemptions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("promo_code_id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("campaign", sa.String(length=80), nullable=True),
        sa.Column("tier", sa.String(), nullable=False),
        sa.Column("duration_days", sa.Integer(), nullable=True),
        sa.Column("redeemed_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["promo_code_id"], ["promo_codes.id"]),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("promo_code_id", "workspace_id", name="uq_promo_redemption_code_workspace"),
        sa.UniqueConstraint("promo_code_id", "user_id", name="uq_promo_redemption_code_user"),
    )
    op.create_index("ix_promo_redemptions_promo_code_id", "promo_redemptions", ["promo_code_id"], unique=False)
    op.create_index("ix_promo_redemptions_workspace_id", "promo_redemptions", ["workspace_id"], unique=False)
    op.create_index("ix_promo_redemptions_user_id", "promo_redemptions", ["user_id"], unique=False)
    op.create_index("ix_promo_redemptions_campaign", "promo_redemptions", ["campaign"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_promo_redemptions_campaign", table_name="promo_redemptions")
    op.drop_index("ix_promo_redemptions_user_id", table_name="promo_redemptions")
    op.drop_index("ix_promo_redemptions_workspace_id", table_name="promo_redemptions")
    op.drop_index("ix_promo_redemptions_promo_code_id", table_name="promo_redemptions")
    op.drop_table("promo_redemptions")
    with op.batch_alter_table("promo_codes") as batch_op:
        batch_op.drop_index("ix_promo_codes_campaign")
        batch_op.drop_column("campaign")
        batch_op.drop_column("grants_lifetime")
        batch_op.drop_column("duration_days")
