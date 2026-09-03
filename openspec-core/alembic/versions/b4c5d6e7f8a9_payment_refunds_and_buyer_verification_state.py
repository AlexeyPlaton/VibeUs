"""payment refunds and buyer verification state

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-09-02 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b4c5d6e7f8a9"
down_revision: Union[str, None] = "a3b4c5d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create durable refund ledger table
    op.create_table(
        "payment_refunds",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("provider_refund_id", sa.String(), nullable=False),
        sa.Column("payment_id", sa.String(), sa.ForeignKey("payments.id"), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(), nullable=False, server_default="RUB"),
        sa.Column("status", sa.String(), nullable=False, server_default="succeeded"),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_payment_refunds_provider_refund_id", "payment_refunds", ["provider_refund_id"], unique=True)
    op.create_index("ix_payment_refunds_payment_id", "payment_refunds", ["payment_id"])

    # 2. Update payments table with buyer verification flag and full fiscal constraints
    with op.batch_alter_table("payments", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("buyer_snapshot_verified", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.drop_constraint("ck_payments_receipt_issued_proof", type_="check")
        batch_op.drop_constraint("ck_payments_fiscal_status", type_="check")
        batch_op.create_check_constraint(
            "ck_payments_fiscal_status",
            "fiscal_status IN ('receipt_not_required', 'receipt_required', 'receipt_issued', 'receipt_refund_required', 'receipt_refunded')",
        )
        batch_op.create_check_constraint(
            "ck_payments_receipt_issued_proof",
            "fiscal_status != 'receipt_issued' OR (status = 'succeeded' AND tax_mode = 'npd' AND receipt_url IS NOT NULL AND receipt_issued_at IS NOT NULL)",
        )
        batch_op.create_check_constraint(
            "ck_payments_receipt_refund_required_state",
            "fiscal_status != 'receipt_refund_required' OR (status IN ('succeeded', 'refunded') AND tax_mode = 'npd')",
        )
        batch_op.create_check_constraint(
            "ck_payments_verified_buyer_email",
            "buyer_snapshot_verified = 0 OR (buyer_email IS NOT NULL AND TRIM(buyer_email) != '')",
        )
        batch_op.create_check_constraint(
            "ck_payments_verified_b2b_buyer",
            "buyer_snapshot_verified = 0 OR buyer_is_b2b = 0 OR (buyer_inn IS NOT NULL AND TRIM(buyer_inn) != '' AND buyer_name IS NOT NULL AND TRIM(buyer_name) != '')",
        )

    # 3. Best-effort backfill buyer_email for legacy rows from historical workspace owner_email without marking verified
    op.execute(
        "UPDATE payments "
        "SET buyer_email = (SELECT owner_email FROM workspaces WHERE workspaces.id = payments.workspace_id) "
        "WHERE buyer_email IS NULL AND EXISTS (SELECT 1 FROM workspaces WHERE workspaces.id = payments.workspace_id)"
    )


def downgrade() -> None:
    with op.batch_alter_table("payments", schema=None) as batch_op:
        batch_op.drop_constraint("ck_payments_verified_b2b_buyer", type_="check")
        batch_op.drop_constraint("ck_payments_verified_buyer_email", type_="check")
        batch_op.drop_constraint("ck_payments_receipt_refund_required_state", type_="check")
        batch_op.drop_constraint("ck_payments_receipt_issued_proof", type_="check")
        batch_op.drop_constraint("ck_payments_fiscal_status", type_="check")
        batch_op.create_check_constraint(
            "ck_payments_fiscal_status",
            "fiscal_status IN ('receipt_not_required', 'receipt_required', 'receipt_issued')",
        )
        batch_op.create_check_constraint(
            "ck_payments_receipt_issued_proof",
            "fiscal_status != 'receipt_issued' OR (receipt_url IS NOT NULL AND receipt_issued_at IS NOT NULL)",
        )
        batch_op.drop_column("buyer_snapshot_verified")

    op.drop_index("ix_payment_refunds_payment_id", table_name="payment_refunds")
    op.drop_index("ix_payment_refunds_provider_refund_id", table_name="payment_refunds")
    op.drop_table("payment_refunds")
