#!/usr/bin/env python3
"""Create and inspect hashed VibeUs promo campaigns.

Raw promo codes are printed only at creation time and never stored in the DB.
Run this inside the API environment so DATABASE_URL/TOKEN_PEPPER match production.
"""
from __future__ import annotations

import argparse
import asyncio
import secrets
from datetime import timedelta

from sqlalchemy import func, select

from database import async_session
import models
import security

TIERS = {"solo", "studio", "business"}


def normalize_code(value: str) -> str:
    code = (value or "").strip().upper()
    if len(code) < 6 or len(code) > 128:
        raise ValueError("Promo code must contain 6..128 characters")
    return code


async def create_code(*, code: str, tier: str, days: int | None, max_uses: int,
                      campaign: str | None, expires_days: int | None,
                      lifetime: bool = False) -> str:
    code = normalize_code(code)
    tier = tier.lower().strip()
    if tier not in TIERS:
        raise ValueError(f"Unsupported tier: {tier}")
    if not lifetime and (days is None or days < 1 or days > 3660):
        raise ValueError("Timed promo duration must be 1..3660 days")
    if max_uses < 1:
        raise ValueError("max_uses must be >= 1")

    now = models.utcnow()
    digest = security.hash_access_token(code)
    async with async_session() as db:
        exists = (await db.execute(select(models.PromoCode.id).where(models.PromoCode.code_digest == digest))).scalar_one_or_none()
        if exists:
            raise ValueError("Promo code already exists")
        db.add(models.PromoCode(
            code_digest=digest,
            tier=tier,
            duration_days=None if lifetime else days,
            grants_lifetime=lifetime,
            campaign=(campaign or None),
            max_uses=max_uses,
            times_used=0,
            expires_at=(now + timedelta(days=expires_days)) if expires_days else None,
            is_active=True,
        ))
        await db.commit()
    return code


async def command_create(args) -> None:
    raw = await create_code(
        code=args.code,
        tier=args.tier,
        days=args.days,
        max_uses=args.max_uses,
        campaign=args.campaign,
        expires_days=args.expires_days,
        lifetime=args.lifetime,
    )
    print("Created. RAW CODE (shown once):")
    print(raw)


async def command_batch(args) -> None:
    codes: list[str] = []
    for index in range(1, args.count + 1):
        raw = f"{args.prefix}-{index:03d}-{secrets.token_hex(3).upper()}"
        codes.append(await create_code(
            code=raw,
            tier=args.tier,
            days=args.days,
            max_uses=1,
            campaign=args.campaign,
            expires_days=args.expires_days,
            lifetime=False,
        ))
    print("Created promo batch. RAW CODES (shown once):")
    for code in codes:
        print(code)


async def command_stats(args) -> None:
    async with async_session() as db:
        stmt = select(models.PromoRedemption)
        if args.campaign:
            stmt = stmt.where(models.PromoRedemption.campaign == args.campaign)
        redemptions = (await db.execute(stmt.order_by(models.PromoRedemption.redeemed_at))).scalars().all()

        payment_rows = (await db.execute(
            select(models.Payment.workspace_id, models.Payment.processed_at)
            .where(models.Payment.status == "succeeded", models.Payment.is_test == False)
        )).all()
        paid_dates: dict[str, list] = {}
        for workspace_id, processed_at in payment_rows:
            if processed_at:
                paid_dates.setdefault(workspace_id, []).append(processed_at)

        project_rows = (await db.execute(
            select(models.Project.workspace_id, func.count(models.Project.id))
            .where(models.Project.is_deleted == False)
            .group_by(models.Project.workspace_id)
        )).all()
        project_counts = {workspace_id: count for workspace_id, count in project_rows}

    if not redemptions:
        print("No promo redemptions found.")
        return

    grouped: dict[tuple[str | None, str], dict[str, int]] = {}
    for redemption in redemptions:
        key = (redemption.campaign, redemption.tier)
        bucket = grouped.setdefault(key, {"redemptions": 0, "paid_after": 0, "second_project": 0})
        bucket["redemptions"] += 1
        if any(dt > redemption.redeemed_at for dt in paid_dates.get(redemption.workspace_id, [])):
            bucket["paid_after"] += 1
        if project_counts.get(redemption.workspace_id, 0) >= 2:
            bucket["second_project"] += 1

    print("campaign\ttier\tredemptions\tpaid_after_promo\tworkspaces_2plus_projects")
    for (campaign, tier), stats in sorted(grouped.items(), key=lambda item: ((item[0][0] or ''), item[0][1])):
        print(
            f"{campaign or '-'}\t{tier}\t{stats['redemptions']}\t"
            f"{stats['paid_after']}\t{stats['second_project']}"
        )


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="VibeUs promo campaign manager")
    sub = p.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create")
    create.add_argument("--code", required=True)
    create.add_argument("--tier", choices=sorted(TIERS), required=True)
    create.add_argument("--days", type=int, default=30)
    create.add_argument("--max-uses", type=int, default=1)
    create.add_argument("--campaign")
    create.add_argument("--expires-days", type=int)
    create.add_argument("--lifetime", action="store_true", help="Explicit legacy/admin-only lifetime grant")
    create.set_defaults(func=command_create)

    batch = sub.add_parser("batch")
    batch.add_argument("--prefix", required=True)
    batch.add_argument("--count", type=int, required=True)
    batch.add_argument("--tier", choices=sorted(TIERS), required=True)
    batch.add_argument("--days", type=int, default=30)
    batch.add_argument("--campaign", required=True)
    batch.add_argument("--expires-days", type=int, default=60)
    batch.set_defaults(func=command_batch)

    stats = sub.add_parser("stats")
    stats.add_argument("--campaign")
    stats.set_defaults(func=command_stats)
    return p


async def main() -> None:
    args = parser().parse_args()
    if getattr(args, "count", 1) < 1 or getattr(args, "count", 1) > 1000:
        raise SystemExit("count must be 1..1000")
    await args.func(args)


if __name__ == "__main__":
    asyncio.run(main())
