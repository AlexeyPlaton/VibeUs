from hashlib import sha256
from urllib.parse import parse_qs, urlsplit

import pytest

import robokassa_service
import settings as settings_module


def _configure(monkeypatch, *, enabled: bool = True):
    monkeypatch.setenv("ENABLE_ROBOKASSA", "true" if enabled else "false")
    monkeypatch.setenv("ROBOKASSA_MERCHANT_LOGIN", "vibeus-test")
    monkeypatch.setenv("ROBOKASSA_PASSWORD1", "password-one")
    monkeypatch.setenv("ROBOKASSA_PASSWORD2", "password-two")
    monkeypatch.setenv("ROBOKASSA_HASH_ALGORITHM", "sha256")
    monkeypatch.setenv("ROBOKASSA_IS_TEST", "true")
    settings_module.get_settings.cache_clear()


def test_payment_url_uses_password1_and_never_exposes_passwords(monkeypatch):
    _configure(monkeypatch)
    url = robokassa_service.build_payment_url(
        amount_rub="2500",
        invoice_id=42,
        description="VibeUs Solo 30 days",
        email="buyer@example.com",
        culture="en",
    )
    parsed = urlsplit(url)
    query = parse_qs(parsed.query)
    expected = sha256(b"vibeus-test:2500.00:42:password-one").hexdigest()

    assert parsed.scheme == "https"
    assert query["MerchantLogin"] == ["vibeus-test"]
    assert query["OutSum"] == ["2500.00"]
    assert query["InvId"] == ["42"]
    assert query["Culture"] == ["en"]
    assert query["Email"] == ["buyer@example.com"]
    assert query["IsTest"] == ["1"]
    assert query["SignatureValue"] == [expected]
    assert "password-one" not in url
    assert "password-two" not in url


def test_result_url_signature_uses_password2_and_rejects_tampering(monkeypatch):
    _configure(monkeypatch)
    signature = sha256(b"2500.000000:42:password-two").hexdigest().upper()
    assert robokassa_service.verify_result_signature(
        out_sum="2500.000000",
        invoice_id=42,
        signature_value=signature,
    ) is True
    assert robokassa_service.verify_result_signature(
        out_sum="2501.000000",
        invoice_id=42,
        signature_value=signature,
    ) is False


def test_adapter_fails_closed_when_disabled(monkeypatch):
    _configure(monkeypatch, enabled=False)
    with pytest.raises(robokassa_service.RobokassaConfigurationError, match="disabled"):
        robokassa_service.build_payment_url(
            amount_rub="100",
            invoice_id=1,
            description="Test",
        )


def test_rejects_invalid_amount_invoice_and_culture(monkeypatch):
    _configure(monkeypatch)
    with pytest.raises(ValueError, match="positive"):
        robokassa_service.build_payment_url(amount_rub="0", invoice_id=1, description="Test")
    with pytest.raises(ValueError, match="positive integer"):
        robokassa_service.build_payment_url(amount_rub="100", invoice_id=0, description="Test")
    with pytest.raises(ValueError, match="culture"):
        robokassa_service.build_payment_url(amount_rub="100", invoice_id=1, description="Test", culture="de")
