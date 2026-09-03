from __future__ import annotations

import argparse
import asyncio
from typing import Optional
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import models
from database import async_session

OFFICIAL_RECEIPT_HOST = "lknpd.nalog.ru"


def validate_receipt_url(raw: str) -> str:
    value = (raw or "").strip()
    parsed = urlsplit(value)
    if parsed.scheme != "https" or (parsed.hostname or "").lower() != OFFICIAL_RECEIPT_HOST:
        raise ValueError(
            "receipt_url must be an HTTPS public receipt link on lknpd.nalog.ru"
        )
    if not parsed.path.startswith("/api/v1/receipt/"):
        raise ValueError("receipt_url does not look like a 'Мой налог' receipt link")
    return value


async def mark_receipt_issued(
    db: AsyncSession,
    payment_id: str,
    receipt_url: str,
    *,
    force: bool = False,
) -> models.Payment:
    url = validate_receipt_url(receipt_url)
    result = await db.execute(
        select(models.Payment).where(models.Payment.id == payment_id).with_for_update()
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise ValueError("Payment not found")
    if payment.status != "succeeded":
        raise ValueError(f"Receipt can be issued only for succeeded payments; status={payment.status}")
    if payment.tax_mode != "npd":
        raise ValueError(f"Manual 'Мой налог' receipt is valid only for tax_mode=npd; tax_mode={payment.tax_mode}")
    if not getattr(payment, "buyer_snapshot_verified", False):
        raise ValueError(
            "Cannot issue receipt for unverified legacy buyer snapshot; "
            "operator must reconcile buyer snapshot first via reconcile_buyer_snapshot"
        )
    if payment.fiscal_status == "receipt_issued" and not force:
        if payment.receipt_url == url:
            return payment
        raise ValueError("Receipt is already recorded; pass --force only to correct an operator mistake")
    if payment.fiscal_status not in {"receipt_required", "receipt_issued"}:
        raise ValueError(f"Payment is not awaiting an NPD receipt; fiscal_status={payment.fiscal_status}")

    payment.receipt_url = url
    payment.receipt_issued_at = models.utcnow()
    payment.fiscal_status = "receipt_issued"
    db.add(
        models.AuditEvent(
            workspace_id=payment.workspace_id,
            event_type="billing.npd_receipt_issued",
            details={
                "payment_id": payment.id,
                "provider_payment_id": payment.provider_payment_id,
                "receipt_url": url,
                "corrected": bool(force),
            },
        )
    )
    await db.commit()
    await db.refresh(payment)
    return payment


async def reconcile_buyer_snapshot(
    db: AsyncSession,
    payment_id: str,
    *,
    buyer_email: str,
    buyer_is_b2b: bool = False,
    buyer_inn: Optional[str] = None,
    buyer_name: Optional[str] = None,
) -> models.Payment:
    email = (buyer_email or "").strip()
    if not email or "@" not in email:
        raise ValueError("A valid non-empty buyer_email is required to reconcile buyer snapshot")
    if buyer_is_b2b:
        inn = (buyer_inn or "").strip()
        name = (buyer_name or "").strip()
        if not inn or not name:
            raise ValueError("B2B buyer snapshot reconciliation requires non-empty buyer_inn and buyer_name")
    else:
        inn = None
        name = None

    result = await db.execute(
        select(models.Payment).where(models.Payment.id == payment_id).with_for_update()
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise ValueError("Payment not found")

    payment.buyer_email = email
    payment.buyer_is_b2b = bool(buyer_is_b2b)
    payment.buyer_inn = inn
    payment.buyer_name = name
    payment.buyer_snapshot_verified = True

    db.add(
        models.AuditEvent(
            workspace_id=payment.workspace_id,
            event_type="billing.npd_buyer_snapshot_reconciled",
            details={
                "payment_id": payment.id,
                "buyer_email": email,
                "buyer_is_b2b": bool(buyer_is_b2b),
                "buyer_inn": inn,
                "buyer_name": name,
            },
        )
    )
    await db.commit()
    await db.refresh(payment)
    return payment


async def reconcile_refunded_receipt(
    db: AsyncSession,
    payment_id: str,
    *,
    notes: Optional[str] = None,
    force: bool = False,
) -> models.Payment:
    result = await db.execute(
        select(models.Payment).where(models.Payment.id == payment_id).with_for_update()
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise ValueError("Payment not found")

    if payment.fiscal_status != "receipt_refund_required" and not force:
        raise ValueError(
            f"Payment does not require refund reconciliation; fiscal_status={payment.fiscal_status}"
        )

    payment.fiscal_status = "receipt_refunded"
    db.add(
        models.AuditEvent(
            workspace_id=payment.workspace_id,
            event_type="billing.npd_receipt_refund_reconciled",
            details={
                "payment_id": payment.id,
                "notes": notes,
                "forced": bool(force),
            },
        )
    )
    await db.commit()
    await db.refresh(payment)
    return payment


async def list_receipts(db: AsyncSession) -> None:
    result = await db.execute(
        select(models.Payment, models.Workspace)
        .join(models.Workspace, models.Workspace.id == models.Payment.workspace_id)
        .where(
            models.Payment.status == "succeeded",
            models.Payment.tax_mode == "npd",
            models.Payment.fiscal_status == "receipt_required",
        )
        .order_by(models.Payment.processed_at.asc(), models.Payment.created_at.asc())
    )
    rows = result.all()
    if not rows:
        print("No NPD receipts are awaiting issuance.")
        return
    print("payment_id\tprovider_payment_id\tamount\tworkspace\tbuyer_email\tbuyer_inn\tbuyer_name\tprocessed_at")
    for payment, workspace in rows:
        amount = f"{payment.amount_minor / 100:.2f} {payment.currency}"
        buyer_email = getattr(payment, "buyer_email", None) or ""
        buyer_inn = getattr(payment, "buyer_inn", None) or ""
        buyer_name = getattr(payment, "buyer_name", None) or ""
        workspace_id = getattr(workspace, "id", "") if workspace else getattr(payment, "workspace_id", "")
        print(
            f"{payment.id}\t{payment.provider_payment_id}\t{amount}\t"
            f"{workspace_id}\t{buyer_email}\t{buyer_inn}\t{buyer_name}\t{payment.processed_at or payment.created_at}"
        )


async def _run(args: argparse.Namespace) -> int:
    async with async_session() as db:
        if args.command == "list":
            await list_receipts(db)
            return 0
        if args.command == "issue":
            payment = await mark_receipt_issued(
                db, args.payment_id, args.receipt_url, force=args.force
            )
            print(f"receipt_issued payment={payment.id} url={payment.receipt_url}")
            return 0
        if args.command == "reconcile-buyer":
            payment = await reconcile_buyer_snapshot(
                db,
                args.payment_id,
                buyer_email=args.buyer_email,
                buyer_is_b2b=args.is_b2b,
                buyer_inn=args.inn,
                buyer_name=args.name,
            )
            print(f"buyer_reconciled payment={payment.id} verified={payment.buyer_snapshot_verified}")
            return 0
        if args.command == "reconcile-refund":
            payment = await reconcile_refunded_receipt(
                db, args.payment_id, notes=args.notes, force=args.force
            )
            print(f"refund_reconciled payment={payment.id} fiscal_status={payment.fiscal_status}")
            return 0
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Operator-only NPD receipt ledger maintenance")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="List succeeded NPD payments awaiting a 'Мой налог' receipt")

    issue = sub.add_parser("issue", help="Record a receipt already issued in 'Мой налог'")
    issue.add_argument("--payment-id", required=True)
    issue.add_argument("--receipt-url", required=True)
    issue.add_argument("--force", action="store_true", help="Correct an already-recorded receipt URL")

    rec_buyer = sub.add_parser("reconcile-buyer", help="Reconcile legacy buyer snapshot before receipt issuance")
    rec_buyer.add_argument("--payment-id", required=True)
    rec_buyer.add_argument("--buyer-email", required=True)
    rec_buyer.add_argument("--is-b2b", action="store_true", default=False)
    rec_buyer.add_argument("--inn", default=None)
    rec_buyer.add_argument("--name", default=None)

    rec_refund = sub.add_parser("reconcile-refund", help="Reconcile NPD receipt after provider refund")
    rec_refund.add_argument("--payment-id", required=True)
    rec_refund.add_argument("--notes", default=None)
    rec_refund.add_argument("--force", action="store_true", default=False)

    args = parser.parse_args()
    try:
        return asyncio.run(_run(args))
    except ValueError as exc:
        parser.error(str(exc))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
