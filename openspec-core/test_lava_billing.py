from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import lava_service
from settings import Settings


class _FakeResponse:
    status_code = 200

    def json(self):
        return {
            "id": "lava-invoice-123",
            "paymentUrl": "https://app.lava.top/pay/lava-invoice-123",
        }


class _FakeClient:
    def __init__(self):
        self.calls = []

    async def post(self, url, *, json, headers):
        self.calls.append((url, json, headers))
        return _FakeResponse()


def _lava_cfg(**overrides):
    base = {
        "enable_lava": True,
        "lava_api_base_url": "https://gate.lava.top",
        "lava_api_key": SimpleNamespace(get_secret_value=lambda: "provider-api-key"),
        "lava_webhook_api_key": SimpleNamespace(get_secret_value=lambda: "webhook-secret"),
        "lava_offer_id_solo": "offer-solo",
        "lava_offer_id_studio": "offer-studio",
        "billing_tax_mode": "npd",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_production_rejects_enabled_lava_without_credentials():
    with pytest.raises(ValidationError) as exc:
        Settings(
            environment="production",
            database_url="postgresql+asyncpg://user:pass@db/vibeus",
            public_base_url="https://vibeus.example",
            preview_base_url="https://preview-vibeus.example.net",
            cors_origins=["https://vibeus.example"],
            token_pepper="x" * 32,
            field_encryption_key="y" * 32,
            enable_demo_seed=False,
            enable_mock_billing=False,
            enable_lava=True,
            global_billing_provider="lava",
        )
    message = str(exc.value)
    assert "LAVA_API_KEY" in message
    assert "LAVA_WEBHOOK_API_KEY" in message
    assert "LAVA offer IDs" in message


def test_production_accepts_complete_lava_configuration():
    cfg = Settings(
        environment="production",
        database_url="postgresql+asyncpg://user:pass@db/vibeus",
        public_base_url="https://vibeus.example",
        preview_base_url="https://preview-vibeus.example.net",
        cors_origins=["https://vibeus.example"],
        token_pepper="x" * 32,
        field_encryption_key="y" * 32,
        enable_demo_seed=False,
        enable_mock_billing=False,
        enable_lava=True,
        global_billing_provider="lava",
        lava_api_key="provider-api-key",
        lava_webhook_api_key="webhook-secret",
        lava_offer_id_solo="offer-solo",
        lava_offer_id_studio="offer-studio",
    )
    assert cfg.enable_lava is True
    assert cfg.global_billing_provider == "lava"


def test_build_invoice_payload_uses_canonical_usd_price(monkeypatch):
    monkeypatch.setattr(lava_service, "get_settings", lambda: _lava_cfg())
    monkeypatch.setattr(lava_service.pricing, "amount", lambda market, tier: lava_service.Decimal("29.00"))

    payload = lava_service.build_invoice_payload(" Buyer@Example.COM ", "solo")

    assert payload == {
        "email": "buyer@example.com",
        "offerId": "offer-solo",
        "currency": "USD",
        "amount": 29.0,
    }


def test_parse_invoice_response_fails_closed_without_https_checkout():
    with pytest.raises(HTTPException) as exc:
        lava_service.parse_invoice_response({"id": "inv-1", "paymentUrl": "http://evil.example/pay"})
    assert exc.value.status_code == 502


def test_webhook_requires_configured_constant_time_api_key(monkeypatch):
    monkeypatch.setattr(lava_service, "get_settings", lambda: _lava_cfg())

    assert lava_service.verify_webhook_api_key("webhook-secret") is True
    assert lava_service.verify_webhook_api_key("wrong") is False
    assert lava_service.verify_webhook_api_key(None) is False


def test_payment_success_envelope_rejects_wrong_event(monkeypatch):
    monkeypatch.setattr(lava_service, "get_settings", lambda: _lava_cfg())
    with pytest.raises(HTTPException) as exc:
        lava_service.validate_payment_success_envelope(
            {"eventType": "payment.failed", "invoiceId": "inv-1"},
            "webhook-secret",
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_create_invoice_calls_documented_v3_endpoint(monkeypatch):
    monkeypatch.setattr(lava_service, "get_settings", lambda: _lava_cfg())
    monkeypatch.setattr(lava_service.pricing, "amount", lambda market, tier: lava_service.Decimal("79.00"))

    client = _FakeClient()
    result = await lava_service.create_invoice(
        workspace_id="ws-1",
        owner_email="owner@example.com",
        tier="studio",
        db=None,
        client=client,
    )

    assert result == {
        "checkout_url": "https://app.lava.top/pay/lava-invoice-123",
        "session_id": "lava-invoice-123",
        "provider": "lava",
        "is_mock": False,
    }
    assert len(client.calls) == 1
    url, payload, headers = client.calls[0]
    assert url == "https://gate.lava.top/api/v3/invoice"
    assert payload["offerId"] == "offer-studio"
    assert payload["currency"] == "USD"
    assert payload["amount"] == 79.0
    assert headers["X-Api-Key"] == "provider-api-key"


@pytest.mark.asyncio
async def test_create_invoice_is_fail_closed_when_disabled(monkeypatch):
    monkeypatch.setattr(lava_service, "get_settings", lambda: _lava_cfg(enable_lava=False))
    with pytest.raises(HTTPException) as exc:
        await lava_service.create_invoice("ws-1", "owner@example.com", db=None, client=_FakeClient())
    assert exc.value.status_code == 503
