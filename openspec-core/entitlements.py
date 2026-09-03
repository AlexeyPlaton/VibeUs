"""Subscription entitlement rules.

The database stores the commercial tier separately from whether it is currently
usable. Callers must use effective_tier()/has_active_paid_entitlement() rather
than trusting Workspace.subscription_tier alone.
"""
from datetime import datetime
from models import Workspace, utcnow

PAID_TIERS = {"solo", "pro", "studio", "team", "business"}


def has_active_paid_entitlement(workspace: Workspace, now: datetime | None = None) -> bool:
    if getattr(workspace, "is_lifetime_free", False):
        return True

    tier = (workspace.subscription_tier or "free").lower()
    if tier not in PAID_TIERS:
        return False

    if (getattr(workspace, "subscription_status", "inactive") or "inactive") != "active":
        return False

    period_end = getattr(workspace, "current_period_end", None)
    if not period_end:
        return False

    return period_end > (now or utcnow())


def effective_tier(workspace: Workspace, now: datetime | None = None) -> str:
    if getattr(workspace, "is_lifetime_free", False):
        return (workspace.subscription_tier or "studio").lower()
    return (workspace.subscription_tier or "free").lower() if has_active_paid_entitlement(workspace, now) else "free"
