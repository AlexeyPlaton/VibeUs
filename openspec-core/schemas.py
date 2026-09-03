"""Public API schemas.

Most stable contracts live in :mod:`schema_contracts`. Registration is defined
here because its legal acceptance contract is stricter and versioned separately.
"""
from typing import Any, Literal, Optional

from pydantic import Field, field_validator, model_validator

from legal_acceptance_context import set_pending_legal_acceptance
from schema_contracts import *  # noqa: F401,F403


class UserCreate(StrictBaseModel):
    email: str = Field(..., min_length=5, max_length=254, pattern=r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")
    password: str = Field(..., min_length=12, max_length=128)
    legal_locale: Literal["en", "ru"]
    accept_terms: bool
    acknowledge_privacy: bool
    consent_personal_data: bool = False
    terms_version: str = Field(..., min_length=1, max_length=32)
    privacy_version: str = Field(..., min_length=1, max_length=32)
    personal_data_consent_version: Optional[str] = Field(default=None, min_length=1, max_length=32)

    @model_validator(mode="after")
    def check_legal_acceptance(self) -> "UserCreate":
        if not self.accept_terms:
            raise ValueError("Acceptance of terms is required")
        if not self.acknowledge_privacy:
            raise ValueError("Privacy Policy acknowledgement is required")
        if self.legal_locale == "ru":
            if not self.consent_personal_data:
                raise ValueError("Separate personal-data consent is required for the Russian legal flow")
            if not self.personal_data_consent_version:
                raise ValueError("personal_data_consent_version is required for the Russian legal flow")
        elif self.consent_personal_data or self.personal_data_consent_version:
            raise ValueError("Personal-data consent is not accepted as the legal basis for the English account flow")

        set_pending_legal_acceptance({
            "email": self.email,
            "legal_locale": self.legal_locale,
            "terms_version": self.terms_version,
            "privacy_version": self.privacy_version,
            "consent_personal_data": self.consent_personal_data,
            "personal_data_consent_version": self.personal_data_consent_version,
        })
        return self

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: Any) -> str:
        if isinstance(v, str):
            return v.strip().lower()
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Password cannot be blank or whitespace only")
        return v

    @field_validator("accept_terms")
    @classmethod
    def require_terms(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("Terms must be accepted to create an account")
        return v

    @field_validator("acknowledge_privacy")
    @classmethod
    def require_privacy_acknowledgement(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("Privacy Policy must be acknowledged to create an account")
        return v
