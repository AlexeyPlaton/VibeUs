import hashlib
import hmac
import secrets
import os
from datetime import datetime, timezone, timedelta
from typing import Optional
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from settings import get_settings

_password_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
)

def get_pepper() -> str:
    return get_settings().token_pepper.get_secret_value()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False

    if hashed_password.startswith("$argon2"):
        try:
            return _password_hasher.verify(hashed_password, plain_password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False

    # Backward compatibility with the pre-Argon2 PBKDF2 format. Successful
    # logins are upgraded in main.login_user().
    if '$' not in hashed_password:
        return False
    salt, stored_hash = hashed_password.split('$', 1)
    
    candidate_hash = hashlib.pbkdf2_hmac(
        'sha256',
        plain_password.encode('utf-8'),
        salt.encode('utf-8'),
        600000
    ).hex()
    
    return hmac.compare_digest(stored_hash, candidate_hash)

def get_password_hash(password: str) -> str:
    return _password_hasher.hash(password)

def password_needs_rehash(hashed_password: str) -> bool:
    if not hashed_password or not hashed_password.startswith("$argon2"):
        return True
    try:
        return _password_hasher.check_needs_rehash(hashed_password)
    except (InvalidHashError, VerificationError):
        return True

def create_access_token():
    raw_token = secrets.token_urlsafe(32)
    pepper = get_pepper()
    hashed_token = hmac.new(
        pepper.encode('utf-8'),
        raw_token.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    return raw_token, hashed_token

def hash_access_token(raw_token: str) -> str:
    pepper = get_pepper()
    return hmac.new(
        pepper.encode('utf-8'),
        raw_token.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

import base64
from cryptography.fernet import Fernet

def get_fernet_cipher() -> Fernet:
    """Return the field-encryption cipher from the single configured key source.

    Production must never silently fall back to a shared/default encryption key.
    Development may still use the explicit development value from Settings, but
    staging/production/quality_gate fail closed when the key is missing or weak.
    """
    settings = get_settings()
    field_key = settings.field_encryption_key.get_secret_value()

    if not field_key:
        raise RuntimeError("FIELD_ENCRYPTION_KEY is not configured")

    if settings.environment in {"staging", "production", "quality_gate"} and len(field_key) < 32:
        raise RuntimeError("FIELD_ENCRYPTION_KEY must contain at least 32 random characters")

    key = base64.urlsafe_b64encode(hashlib.sha256(field_key.encode("utf-8")).digest())
    return Fernet(key)

def encrypt_field(plain_text: Optional[str]) -> Optional[str]:
    if not plain_text:
        return None
    cipher = get_fernet_cipher()
    return cipher.encrypt(plain_text.encode("utf-8")).decode("utf-8")

def decrypt_field(encrypted_text: Optional[str]) -> Optional[str]:
    if not encrypted_text:
        return None
    cipher = get_fernet_cipher()
    try:
        return cipher.decrypt(encrypted_text.encode("utf-8")).decode("utf-8")
    except Exception as exc:
        # Never reinterpret ciphertext as plaintext. That hides key-rotation or
        # corruption failures and can accidentally forward ciphertext to APIs.
        raise RuntimeError("Unable to decrypt protected field") from exc

