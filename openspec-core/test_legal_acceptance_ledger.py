import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import models
import schemas
from legal_acceptance_context import clear_pending_legal_acceptance


def _payload(locale: str = "en") -> dict:
    is_ru = locale == "ru"
    return {
        "email": f"legal-{locale}@example.com",
        "password": "very-secure-password-123",
        "legal_locale": locale,
        "accept_terms": True,
        "acknowledge_privacy": True,
        "consent_personal_data": is_ru,
        "terms_version": "2026-09-03",
        "privacy_version": "2026-09-03",
        "personal_data_consent_version": "2026-09-03" if is_ru else None,
    }


def test_registration_requires_terms_and_privacy_separately():
    payload = _payload("en")
    payload["acknowledge_privacy"] = False
    with pytest.raises(ValidationError, match="Privacy Policy must be acknowledged"):
        schemas.UserCreate(**payload)

    payload = _payload("en")
    payload["accept_terms"] = False
    with pytest.raises(ValidationError, match="Terms"):
        schemas.UserCreate(**payload)


def test_ru_registration_requires_separate_personal_data_consent():
    payload = _payload("ru")
    payload["consent_personal_data"] = False
    with pytest.raises(ValidationError, match="personal-data consent"):
        schemas.UserCreate(**payload)


def test_en_registration_rejects_fake_personal_data_consent_basis():
    payload = _payload("en")
    payload["consent_personal_data"] = True
    payload["personal_data_consent_version"] = "2026-09-03"
    with pytest.raises(ValidationError, match="not accepted as the legal basis"):
        schemas.UserCreate(**payload)


def test_validated_registration_creates_immutable_per_document_ledger_rows():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    try:
        for locale, expected_types in (
            ("en", {"terms", "privacy_acknowledgement"}),
            ("ru", {"terms", "privacy_acknowledgement", "personal_data_consent"}),
        ):
            payload = _payload(locale)
            data = schemas.UserCreate(**payload)
            with Session(engine) as db:
                user = models.User(
                    email=data.email,
                    hashed_password="test-hash",
                    terms_version=data.terms_version,
                    terms_accepted_at=models.utcnow(),
                    privacy_version=data.privacy_version,
                    privacy_acknowledged_at=models.utcnow(),
                )
                db.add(user)
                db.commit()
                rows = list(db.scalars(
                    select(models.LegalAcceptance)
                    .where(models.LegalAcceptance.user_id == user.id)
                ))
                assert {row.document_type for row in rows} == expected_types
                assert {row.legal_locale for row in rows} == {locale}
                assert {row.document_version for row in rows} == {"2026-09-03"}
                assert all(row.accepted_at is not None for row in rows)
    finally:
        clear_pending_legal_acceptance()
        engine.dispose()
