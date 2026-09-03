"""Release-gate collection with the current registration legal contract.

The large release scenarios live in ``release_gate_cases`` so unrelated gates do
not duplicate the account-registration payload. This module supplies the one
canonical valid EN registration helper and replaces only the tests whose purpose
is the legal-acceptance boundary itself.
"""
import pytest
from sqlalchemy import select

import models
import release_gate_cases as cases
from release_gate_cases import *  # noqa: F401,F403


TEST_LEGAL_VERSION = "test-v1"


def legal_registration_payload(email: str) -> dict:
    return {
        "email": email,
        "password": "Correct-Horse-42!Battery",
        "legal_locale": "en",
        "accept_terms": True,
        "acknowledge_privacy": True,
        "consent_personal_data": False,
        "terms_version": TEST_LEGAL_VERSION,
        "privacy_version": TEST_LEGAL_VERSION,
        "personal_data_consent_version": None,
    }


async def _register_login(client, email="release@test.dev") -> dict:
    reg = await client.post("/api/auth/register", json=legal_registration_payload(email))
    assert reg.status_code == 200, reg.text
    login = await client.post("/api/auth/login", json={
        "email": email,
        "password": "Correct-Horse-42!Battery",
    })
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _register_browser_login(client, email="browser@test.dev") -> None:
    reg = await client.post("/api/auth/register", json=legal_registration_payload(email))
    assert reg.status_code == 200, reg.text
    login = await client.post("/api/auth/browser-login", json={
        "email": email,
        "password": "Correct-Horse-42!Battery",
    })
    assert login.status_code == 200, login.text
    assert "access_token" not in login.json()
    assert "HttpOnly" in login.headers.get("set-cookie", "")


# Imported test functions keep ``release_gate_cases`` as their globals, so bind
# their shared helpers to the current legal contract before pytest executes them.
cases.register_login = _register_login
cases.register_browser_login = _register_browser_login
register_login = _register_login
register_browser_login = _register_browser_login


@pytest.mark.asyncio
async def test_registration_requires_contract_acceptance_and_records_version(client):
    rejected = await client.post("/api/auth/register", json={
        "email": "noaccept@test.dev",
        "password": "Correct-Horse-42!Battery",
        "legal_locale": "en",
        "accept_terms": False,
        "acknowledge_privacy": True,
        "consent_personal_data": False,
        "terms_version": "v1",
        "privacy_version": "v1",
        "personal_data_consent_version": None,
    })
    assert rejected.status_code == 422

    accepted_payload = legal_registration_payload("accepted@test.dev")
    accepted_payload["terms_version"] = "2026-09-03"
    accepted_payload["privacy_version"] = "2026-09-03"
    accepted = await client.post("/api/auth/register", json=accepted_payload)
    assert accepted.status_code == 200, accepted.text

    async with cases.TestingSessionLocal() as db:
        user = (await db.execute(
            select(models.User).where(models.User.email == "accepted@test.dev")
        )).scalar_one()
        assert user.terms_version == "2026-09-03"
        assert user.terms_accepted_at is not None
        assert user.privacy_acknowledged_at is not None

        legal_rows = (await db.execute(
            select(models.LegalAcceptance)
            .where(models.LegalAcceptance.user_id == user.id)
        )).scalars().all()
        assert {row.document_type for row in legal_rows} == {
            "terms",
            "privacy_acknowledgement",
        }
        assert {row.document_version for row in legal_rows} == {"2026-09-03"}
        assert {row.legal_locale for row in legal_rows} == {"en"}

        audit = (await db.execute(
            select(models.AuditEvent).where(models.AuditEvent.user_id == user.id)
        )).scalars().all()
        assert any(row.event_type == "legal.account_terms_accepted" for row in audit)


@pytest.mark.asyncio
async def test_registration_requires_explicit_legal_consent_fields(client):
    base = {
        "password": "ValidPassword123!",
        "terms_version": "2026-09-03",
        "privacy_version": "2026-09-03",
    }

    # Terms acceptance, Privacy acknowledgement and locale are independent
    # required contract facts. Missing any one of them must fail at the API edge.
    missing_terms = await client.post("/api/auth/register", json={
        **base,
        "email": "missing-terms@example.com",
        "legal_locale": "en",
        "acknowledge_privacy": True,
    })
    assert missing_terms.status_code == 422

    missing_privacy = await client.post("/api/auth/register", json={
        **base,
        "email": "missing-privacy@example.com",
        "legal_locale": "en",
        "accept_terms": True,
    })
    assert missing_privacy.status_code == 422

    missing_locale = await client.post("/api/auth/register", json={
        **base,
        "email": "missing-locale@example.com",
        "accept_terms": True,
        "acknowledge_privacy": True,
    })
    assert missing_locale.status_code == 422

    false_terms = await client.post("/api/auth/register", json={
        **base,
        "email": "false-terms@example.com",
        "legal_locale": "en",
        "accept_terms": False,
        "acknowledge_privacy": True,
    })
    assert false_terms.status_code == 422

    # EN core account processing is not disguised as consent: Terms + privacy
    # acknowledgement are sufficient, while a personal-data consent field is
    # explicitly false/absent as a legal basis.
    valid_en = await client.post("/api/auth/register", json={
        **base,
        "email": "valid-en@example.com",
        "legal_locale": "en",
        "accept_terms": True,
        "acknowledge_privacy": True,
        "consent_personal_data": False,
        "personal_data_consent_version": None,
    })
    assert valid_en.status_code == 200, valid_en.text

    fake_en_consent = await client.post("/api/auth/register", json={
        **base,
        "email": "fake-en-consent@example.com",
        "legal_locale": "en",
        "accept_terms": True,
        "acknowledge_privacy": True,
        "consent_personal_data": True,
        "personal_data_consent_version": "2026-09-03",
    })
    assert fake_en_consent.status_code == 422

    # Russian hosted registration additionally requires the standalone consent
    # document and records it separately from Terms and Privacy acknowledgement.
    ru_without_consent = await client.post("/api/auth/register", json={
        **base,
        "email": "ru-no-consent@example.com",
        "legal_locale": "ru",
        "accept_terms": True,
        "acknowledge_privacy": True,
        "consent_personal_data": False,
    })
    assert ru_without_consent.status_code == 422

    valid_ru = await client.post("/api/auth/register", json={
        **base,
        "email": "valid-ru@example.com",
        "legal_locale": "ru",
        "accept_terms": True,
        "acknowledge_privacy": True,
        "consent_personal_data": True,
        "personal_data_consent_version": "2026-09-03",
    })
    assert valid_ru.status_code == 200, valid_ru.text

    async with cases.TestingSessionLocal() as db:
        ru_user = (await db.execute(
            select(models.User).where(models.User.email == "valid-ru@example.com")
        )).scalar_one()
        rows = (await db.execute(
            select(models.LegalAcceptance)
            .where(models.LegalAcceptance.user_id == ru_user.id)
        )).scalars().all()
        assert {row.document_type for row in rows} == {
            "terms",
            "privacy_acknowledgement",
            "personal_data_consent",
        }
        assert {row.legal_locale for row in rows} == {"ru"}
