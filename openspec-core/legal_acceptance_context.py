from __future__ import annotations

from contextvars import ContextVar
from typing import Any, Optional


_pending_legal_acceptance: ContextVar[Optional[dict[str, Any]]] = ContextVar(
    "vibeus_pending_legal_acceptance",
    default=None,
)


def set_pending_legal_acceptance(payload: dict[str, Any]) -> None:
    """Store validated registration legal facts for the current async request.

    The value is consumed by the User mapper after the account row is inserted,
    so the legal acceptance ledger is committed in the same database transaction
    as account creation without changing the public registration endpoint shape.
    """
    _pending_legal_acceptance.set(dict(payload))


def peek_pending_legal_acceptance() -> Optional[dict[str, Any]]:
    value = _pending_legal_acceptance.get()
    return dict(value) if value else None


def clear_pending_legal_acceptance() -> None:
    _pending_legal_acceptance.set(None)
