"""payment buyer snapshot and check constraints

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-09-02 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a3b4c5d6e7f8"
down_revision: Union[str, None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("payments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("buyer_email", sa.String(length=255), nullable=True))
        batch_op.add_column(
            sa.Column("buyer_is_b2b", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(sa.Column("buyer_inn", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("buyer_name", sa.String(length=255), nullable=True))
        batch_op.create_check_constraint(
            "ck_payments_tax_mode",
            "tax_mode IN ('npd', 'kkt_54fz')",
        )
        batch_op.create_check_constraint(
            "ck_payments_fiscal_status",
            "fiscal_status IN ('receipt_not_required', 'receipt_required', 'receipt_issued')",
        )
        batch_op.create_check_constraint(
            "ck_payments_receipt_required_state",
            "fiscal_status != 'receipt_required' OR (status = 'succeeded' AND tax_mode = 'npd')",
        )
        batch_op.create_check_constraint(
            "ck_payments_receipt_issued_proof",
            "fiscal_status != 'receipt_issued' OR (receipt_url IS NOT NULL AND receipt_issued_at IS NOT NULL)",
        )


def downgrade() -> None:
    with op.batch_alter_table("payments", schema=None) as batch_op:
        batch_op.drop_constraint("ck_payments_receipt_issued_proof", type_="check")
        batch_op.drop_constraint("ck_payments_receipt_required_state", type_="check")
        batch_op.drop_constraint("ck_payments_fiscal_status", type_="check")
        batch_op.drop_constraint("ck_payments_tax_mode", type_="check")
        batch_op.drop_column("buyer_name")
        batch_op.drop_column("buyer_inn")
        batch_op.drop_column("buyer_is_b2b")
        batch_op.drop_column("buyer_email")
