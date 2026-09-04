import base64
import json

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

import github_app_auth


def _decode_json(part: str):
    padded = part + "=" * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(padded.encode()))


@pytest.fixture
def app_env(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    monkeypatch.setenv("GITHUB_APP_ID", "12345")
    monkeypatch.setenv("GITHUB_APP_SLUG", "vibeus-test")
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY_B64", base64.b64encode(pem).decode())
    github_app_auth.reset_caches_for_tests()
    yield
    github_app_auth.reset_caches_for_tests()


def test_github_app_jwt_is_short_lived_rs256(app_env):
    token = github_app_auth.build_app_jwt(now=2_000_000_000)
    header_raw, payload_raw, signature = token.split(".")
    header = _decode_json(header_raw)
    payload = _decode_json(payload_raw)

    assert header == {"alg": "RS256", "typ": "JWT"}
    assert payload["iss"] == "12345"
    assert payload["iat"] == 1_999_999_940
    assert payload["exp"] == 2_000_000_540
    assert payload["exp"] - payload["iat"] == 600
    assert signature


@pytest.mark.asyncio
async def test_github_app_credential_is_preferred_over_legacy_pat(app_env, monkeypatch):
    async def app_token(repo):
        assert repo == "acme/shop"
        return "ghs_12345.jwt-shaped-installation-token"

    monkeypatch.setattr(github_app_auth, "installation_token", app_token)
    kind, token = await github_app_auth.resolve_credential("acme/shop", "github_pat_legacy")
    assert kind == "github_app"
    assert token == "ghs_12345.jwt-shaped-installation-token"


@pytest.mark.asyncio
async def test_missing_app_installation_falls_back_to_legacy_pat(app_env, monkeypatch):
    async def no_app_token(repo):
        return None

    monkeypatch.setattr(github_app_auth, "installation_token", no_app_token)
    kind, token = await github_app_auth.resolve_credential("acme/shop", "github_pat_legacy")
    assert (kind, token) == ("pat", "github_pat_legacy")


@pytest.mark.asyncio
async def test_partial_app_configuration_does_not_break_legacy_pat(monkeypatch):
    monkeypatch.setenv("GITHUB_APP_ID", "12345")
    monkeypatch.delenv("GITHUB_APP_SLUG", raising=False)
    monkeypatch.delenv("GITHUB_APP_PRIVATE_KEY_B64", raising=False)
    kind, token = await github_app_auth.resolve_credential("acme/shop", "github_pat_legacy")
    assert (kind, token) == ("pat", "github_pat_legacy")
    assert github_app_auth.app_configuration()["partial"] is True


def test_invalid_repository_is_rejected_before_github_io():
    with pytest.raises(github_app_auth.GitHubAppError):
        github_app_auth._safe_repo("https://github.com/acme/shop")
