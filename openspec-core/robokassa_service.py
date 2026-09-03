from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
import hashlib
import hmac
from urllib.parse import urlencode

from settings import get_settings


class RobokassaConfigurationError(RuntimeError):
    pass


def _hash(value: str, algorithm: str) -> str:
    try:
        digest = hashlib.new(algorithm)
    except ValueError as exc:
        raise RobokassaConfigurationError("Unsupported Robokassa hash algorithm") from exc
    digest.update(value.encode("utf-8"))
    return digest.hexdigest()


def _amount_rub(value: Decimal | str | int) -> str:
    amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if amount <= 0:
        raise ValueError("Robokassa amount must be positive")
    return f"{amount:.2f}"


def _require_configuration():
    cfg = get_settings()
    if not cfg.enable_robokassa:
        raise RobokassaConfigurationError("Robokassa billing is disabled")
    merchant = cfg.robokassa_merchant_login.strip()
    password1 = cfg.robokassa_password1.get_secret_value()
    password2 = cfg.robokassa_password2.get_secret_value()
    if not merchant or not password1 or not password2:
        raise RobokassaConfigurationError("Robokassa merchant credentials are incomplete")
    return cfg, merchant, password1, password2


def build_payment_url(
    *,
    amount_rub: Decimal | str | int,
    invoice_id: int,
    description: str,
    email: str | None = None,
    culture: str = "en",
) -> str:
    """Build a signed one-time Robokassa hosted payment URL.

    Robokassa's classic merchant form defines OutSum in RUB. The buyer can use
    payment methods enabled for the merchant, including foreign bank cards where
    Robokassa has enabled them. Currency/FX policy for VibeUs international
    prices therefore remains an activation-layer concern and is deliberately
    not guessed in this adapter.
    """
    cfg, merchant, password1, _password2 = _require_configuration()
    if invoice_id <= 0:
        raise ValueError("Robokassa invoice_id must be a positive integer")
    clean_description = " ".join(str(description).split())[:100]
    if not clean_description:
        raise ValueError("Robokassa description is required")
    normalized_culture = culture.lower().strip()
    if normalized_culture not in {"en", "ru"}:
        raise ValueError("Robokassa culture must be 'en' or 'ru'")

    out_sum = _amount_rub(amount_rub)
    base = f"{merchant}:{out_sum}:{invoice_id}:{password1}"
    signature = _hash(base, cfg.robokassa_hash_algorithm)
    params = {
        "MerchantLogin": merchant,
        "OutSum": out_sum,
        "InvId": str(invoice_id),
        "Description": clean_description,
        "SignatureValue": signature,
        "Culture": normalized_culture,
    }
    if email:
        params["Email"] = str(email).strip()
    if cfg.robokassa_is_test:
        params["IsTest"] = "1"
    return f"{str(cfg.robokassa_payment_url)}?{urlencode(params)}"


def verify_result_signature(*, out_sum: str, invoice_id: int | str, signature_value: str) -> bool:
    """Verify Robokassa ResultURL authentication using merchant Password #2.

    Entitlement code must additionally compare invoice identity, amount and
    local pending-payment state before granting access. Signature validity alone
    is never sufficient to activate a plan.
    """
    cfg, _merchant, _password1, password2 = _require_configuration()
    raw_sum = str(out_sum).strip()
    raw_invoice = str(invoice_id).strip()
    if not raw_sum or not raw_invoice or not signature_value:
        return False
    expected = _hash(
        f"{raw_sum}:{raw_invoice}:{password2}",
        cfg.robokassa_hash_algorithm,
    )
    return hmac.compare_digest(expected.lower(), str(signature_value).strip().lower())
