from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import quote

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

GITHUB_API_BASE = "https://api.github.com"
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
logger = logging.getLogger("vibeus.github_app")

_installation_cache: dict[str, tuple[int, float]] = {}
_token_cache: dict[str, tuple[str, float]] = {}


class GitHubAppError(RuntimeError):
    pass


class GitHubAppConfigurationError(GitHubAppError):
    pass


class GitHubAppStateError(GitHubAppError):
    status_code = 400


class GitHubAppRequestError(GitHubAppError):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _config() -> tuple[str, str, str]:
    return (
        os.getenv("GITHUB_APP_ID", "").strip(),
        os.getenv("GITHUB_APP_SLUG", "").strip(),
        os.getenv("GITHUB_APP_PRIVATE_KEY_B64", "").strip(),
    )


def _state_secret() -> str:
    return os.getenv("GITHUB_APP_STATE_SECRET", "").strip() or os.getenv("TOKEN_PEPPER", "").strip()


def _setup_url() -> Optional[str]:
    explicit = os.getenv("GITHUB_APP_SETUP_URL", "").strip()
    if explicit:
        return explicit if explicit.startswith(("https://", "http://")) else None
    public_base = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
    if public_base.startswith(("https://", "http://")):
        return f"{public_base}/app/integrations/github/callback"
    return None


def app_configuration() -> dict[str, Any]:
    app_id, slug, private_key_b64 = _config()
    present = [bool(app_id), bool(slug), bool(private_key_b64)]
    configured = all(present)
    return {
        "configured": configured,
        "partial": any(present) and not configured,
        "slug": slug or None,
        "install_url": f"https://github.com/apps/{slug}/installations/new" if slug else None,
        "setup_url": _setup_url(),
        "state_ready": len(_state_secret()) >= 32,
    }


def _safe_repo(repo: Optional[str]) -> str:
    value = (repo or "").strip().strip("/")
    if not REPO_RE.fullmatch(value):
        raise GitHubAppError("GitHub repository must use owner/repo format")
    return value


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode((value + "=" * (-len(value) % 4)).encode("ascii"))
    except Exception as exc:
        raise GitHubAppStateError("GitHub App install state is malformed") from exc


def build_install_state(
    *,
    project_id: str,
    user_id: str,
    repo: str,
    now: Optional[int] = None,
    ttl_seconds: int = 900,
) -> str:
    secret = _state_secret()
    if len(secret) < 32:
        raise GitHubAppConfigurationError(
            "GitHub App onboarding requires GITHUB_APP_STATE_SECRET or TOKEN_PEPPER with at least 32 characters"
        )
    current = int(time.time() if now is None else now)
    repository = _safe_repo(repo)
    payload = {
        "v": 1,
        "pid": str(project_id),
        "uid": str(user_id),
        "repo": repository,
        "iat": current,
        "exp": current + max(60, min(int(ttl_seconds), 1800)),
        "nonce": secrets.token_urlsafe(12),
    }
    encoded = _b64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = _b64url(hmac.new(secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest())
    return f"{encoded}.{signature}"


def parse_install_state(token: str, *, now: Optional[int] = None) -> dict[str, Any]:
    secret = _state_secret()
    if len(secret) < 32:
        raise GitHubAppConfigurationError("GitHub App onboarding state verification is not configured")
    try:
        encoded, supplied_signature = str(token or "").split(".", 1)
    except ValueError as exc:
        raise GitHubAppStateError("GitHub App install state is malformed") from exc
    expected = _b64url(hmac.new(secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(expected, supplied_signature):
        raise GitHubAppStateError("GitHub App install state signature is invalid")
    try:
        payload = json.loads(_b64url_decode(encoded).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise GitHubAppStateError("GitHub App install state is malformed") from exc
    if not isinstance(payload, dict) or payload.get("v") != 1:
        raise GitHubAppStateError("GitHub App install state version is not supported")
    current = int(time.time() if now is None else now)
    issued = int(payload.get("iat") or 0)
    expires = int(payload.get("exp") or 0)
    if issued <= 0 or expires <= issued or issued > current + 60:
        raise GitHubAppStateError("GitHub App install state timestamps are invalid")
    if expires < current or expires - issued > 1800:
        raise GitHubAppStateError("GitHub App install state has expired")
    project_id = str(payload.get("pid") or "").strip()
    user_id = str(payload.get("uid") or "").strip()
    if not project_id or not user_id:
        raise GitHubAppStateError("GitHub App install state identity is incomplete")
    try:
        payload["repo"] = _safe_repo(str(payload.get("repo") or ""))
    except GitHubAppError as exc:
        raise GitHubAppStateError("GitHub App install state repository is invalid") from exc
    return payload


def install_url_for_state(state: str) -> str:
    base = app_configuration().get("install_url")
    if not base:
        raise GitHubAppConfigurationError("GitHub App slug is not configured")
    return f"{base}?state={quote(state, safe='')}"


def build_app_jwt(*, now: Optional[int] = None) -> str:
    app_id, _slug, private_key_b64 = _config()
    if not app_configuration()["configured"]:
        raise GitHubAppConfigurationError("GitHub App is not fully configured")
    current = int(time.time() if now is None else now)
    try:
        pem = base64.b64decode(private_key_b64, validate=True)
        private_key = serialization.load_pem_private_key(pem, password=None)
    except Exception as exc:
        raise GitHubAppConfigurationError("GitHub App private key is invalid") from exc
    if not isinstance(private_key, rsa.RSAPrivateKey):
        raise GitHubAppConfigurationError("GitHub App private key must be RSA")
    header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64url(json.dumps({"iat": current - 60, "exp": current + 540, "iss": app_id}, separators=(",", ":")).encode())
    signing_input = f"{header}.{payload}".encode("ascii")
    signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    return f"{header}.{payload}.{_b64url(signature)}"


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "VibeUs-GitHub-App/1.0",
    }


async def _request(
    method: str,
    path: str,
    token: str,
    *,
    params: Optional[dict[str, Any]] = None,
    json_body: Optional[dict[str, Any]] = None,
    allowed: tuple[int, ...] = (),
) -> Any:
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.request(
                method,
                f"{GITHUB_API_BASE}{path}",
                headers=_headers(token),
                params=params,
                json=json_body,
            )
    except httpx.HTTPError as exc:
        raise GitHubAppRequestError("GitHub App request failed") from exc
    if response.status_code in allowed:
        return None
    if response.status_code < 200 or response.status_code >= 300:
        message = "GitHub App request was rejected"
        try:
            payload = response.json()
            if isinstance(payload, dict) and payload.get("message"):
                message = f"GitHub: {payload['message']}"
        except Exception:
            pass
        raise GitHubAppRequestError(message, response.status_code)
    if response.status_code == 204 or not response.content:
        return None
    return response.json()


async def resolve_installation_id(repo: str) -> Optional[int]:
    repository = _safe_repo(repo)
    config = app_configuration()
    if not config["configured"]:
        return None
    key = repository.lower()
    cached = _installation_cache.get(key)
    if cached and cached[1] > time.monotonic():
        return cached[0]
    data = await _request(
        "GET",
        f"/repos/{repository}/installation",
        build_app_jwt(),
        allowed=(404,),
    )
    if data is None:
        return None
    installation_id = int(data.get("id") or 0)
    if installation_id <= 0:
        raise GitHubAppRequestError("GitHub returned an invalid App installation")
    _installation_cache[key] = (installation_id, time.monotonic() + 300)
    return installation_id


async def installation_token(repo: str) -> Optional[str]:
    repository = _safe_repo(repo)
    key = repository.lower()
    cached = _token_cache.get(key)
    now = time.time()
    if cached and cached[1] > now + 90:
        return cached[0]
    installation_id = await resolve_installation_id(repository)
    if not installation_id:
        return None
    repo_name = repository.split("/", 1)[1]
    data = await _request(
        "POST",
        f"/app/installations/{installation_id}/access_tokens",
        build_app_jwt(),
        json_body={"repositories": [repo_name]},
    )
    token = str((data or {}).get("token") or "").strip()
    if not token:
        raise GitHubAppRequestError("GitHub did not return an installation token")
    expires_at = str((data or {}).get("expires_at") or "")
    try:
        expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
    except Exception:
        expiry = now + 300
    _token_cache[key] = (token, expiry)
    return token


async def resolve_credential(repo: str, legacy_pat: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    repository = _safe_repo(repo)
    config = app_configuration()
    if config["configured"]:
        token = await installation_token(repository)
        if token:
            return "github_app", token
    legacy = (legacy_pat or "").strip()
    if legacy:
        return "pat", legacy
    return None, None


async def credential_status(repo: Optional[str], legacy_pat: Optional[str]) -> dict[str, Any]:
    config = app_configuration()
    repository = (repo or "").strip().strip("/")
    installed = False
    installation_id: Optional[int] = None
    error: Optional[str] = None
    if repository and config["configured"]:
        try:
            installation_id = await resolve_installation_id(repository)
            installed = bool(installation_id)
        except GitHubAppError as exc:
            error = str(exc)
    has_pat = bool((legacy_pat or "").strip())
    credential_type = "github_app" if installed else ("pat" if has_pat else None)
    return {
        **config,
        "app_installed": installed,
        "installation_id": installation_id,
        "has_pat": has_pat,
        "credential_type": credential_type,
        "configuration_error": "GitHub App environment is only partially configured" if config["partial"] else error,
    }


async def test_repository(repo: str, legacy_pat: Optional[str]) -> dict[str, Any]:
    repository = _safe_repo(repo)
    credential_type, token = await resolve_credential(repository, legacy_pat)
    if not token:
        return {"ok": False, "credential_type": None, "message": "GitHub App is not installed for this repository and no legacy PAT is available"}
    data = await _request("GET", f"/repos/{repository}", token)
    full_name = str((data or {}).get("full_name") or "")
    if full_name.lower() != repository.lower():
        raise GitHubAppRequestError("GitHub repository identity did not match the requested repository")
    return {
        "ok": True,
        "credential_type": credential_type,
        "repo_name": full_name,
        "private": bool((data or {}).get("private")),
    }


def reset_caches_for_tests() -> None:
    _installation_cache.clear()
    _token_cache.clear()
