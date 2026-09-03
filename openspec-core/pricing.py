from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from settings import get_settings

PAID_TIERS = ("solo", "studio")
PROJECT_LIMITS = {"free": 1, "solo": 10, "studio": 50, "business": 10**9}


def normalize_tier(tier: str) -> str:
    normalized = str(getattr(tier, "value", tier)).strip().lower()
    return {"pro": "solo", "team": "studio", "enterprise": "studio"}.get(normalized, normalized)


def _money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def amount(market: str, tier: str) -> Decimal:
    settings = get_settings()
    tier = normalize_tier(tier)
    if tier not in PAID_TIERS:
        raise ValueError(f"Unsupported paid tier: {tier}")
    market = (market or settings.pricing_default_market).strip().lower()
    if market == "ru":
        return settings.price_rub_solo if tier == "solo" else settings.price_rub_studio
    if market == "global":
        return settings.price_usd_solo if tier == "solo" else settings.price_usd_studio
    raise ValueError(f"Unsupported pricing market: {market}")


def amount_minor(market: str, tier: str) -> int:
    return int((amount(market, tier) * Decimal(100)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _display(value: Decimal, currency: str) -> str:
    rounded = value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    if currency == "RUB":
        return f"{int(rounded):,}".replace(",", " ") + " ₽"
    return f"${int(rounded):,}"


def global_billing_enabled() -> bool:
    settings = get_settings()
    if not settings.enable_global_pricing:
        return False
    return {
        "cloudpayments": bool(settings.enable_cloudpayments),
        "stripe": bool(settings.enable_stripe),
        "lava": bool(settings.enable_lava),
    }.get(settings.global_billing_provider, False)


def public_catalog() -> dict[str, Any]:
    settings = get_settings()
    ru = {
        "market": "ru",
        "currency": "RUB",
        "period_days": settings.billing_period_days,
        "billing_enabled": bool(settings.enable_yookassa),
        "plans": {
            tier: {
                "amount": _money(amount("ru", tier)),
                "display": _display(amount("ru", tier), "RUB"),
                "project_limit": PROJECT_LIMITS[tier],
            }
            for tier in PAID_TIERS
        },
    }
    global_market = {
        "market": "global",
        "currency": "USD",
        "period_days": settings.billing_period_days,
        "visible": bool(settings.enable_global_pricing),
        "billing_enabled": global_billing_enabled(),
        "provider": settings.global_billing_provider if settings.enable_global_pricing else None,
        "requires_billing_country": True,
        "business_use_only": True,
        "plans": {
            tier: {
                "amount": _money(amount("global", tier)),
                "display": _display(amount("global", tier), "USD"),
                "project_limit": PROJECT_LIMITS[tier],
            }
            for tier in PAID_TIERS
        },
    }
    return {
        "default_market": settings.pricing_default_market,
        "period_days": settings.billing_period_days,
        "markets": {"ru": ru, "global": global_market},
    }
