"""
VibeUs Runtime Error Bridge — lightweight FastAPI / Starlette middleware.

This module is intentionally dependency-light (httpx + starlette) so it can be
copied into a service or later extracted into a standalone `vibeus` package.
"""
from __future__ import annotations

import asyncio
import logging
import re
import traceback
import uuid
from typing import Any, Callable, Optional

try:
    import httpx
except ImportError:  # pragma: no cover - optional SDK dependency
    httpx = None

try:
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request
    from starlette.responses import Response
except ImportError:  # pragma: no cover - optional SDK dependency
    BaseHTTPMiddleware = object
    Request = Any
    Response = Any

logger = logging.getLogger("vibeus.sdk")
_SAFE_CORRELATION_ID = re.compile(r"^[A-Za-z0-9_.:-]{8,64}$")


def _redact_runtime_text(value: Optional[str], max_length: int = 4000) -> str:
    """Minimize sensitive exception data before it leaves the host service."""
    if not value:
        return ""
    text = str(value)
    text = re.sub(
        r"(?i)([a-z][a-z0-9+.-]*://)[^\s/:@]+:[^\s@]+@",
        r"\1<redacted>@",
        text,
    )
    text = re.sub(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+", "Bearer <redacted>", text)
    text = re.sub(
        r"(?i)\b(authorization|cookie|set-cookie|password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)"
        r"(\s*[:=]\s*)([^\s,;]+)",
        r"\1\2<redacted>",
        text,
    )
    text = re.sub(
        r"(?i)([?&](?:token|key|secret|password|authorization)=)[^&\s]+",
        r"\1<redacted>",
        text,
    )
    text = re.sub(r"\bvb_(?:live|ingest)_[A-Za-z0-9_-]{8,}\b", "<vibeus-secret>", text)
    text = re.sub(
        r"\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b",
        "<secret>",
        text,
    )
    text = re.sub(
        r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b",
        "<jwt>",
        text,
    )
    text = re.sub(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "<email>", text)
    return text[:max_length]


def _safe_filename(filename: str) -> str:
    value = _redact_runtime_text(filename, 1024).replace("\\", "/")
    parts = [part for part in value.split("/") if part]
    return "/".join(parts[-3:])[:512] if parts else "unknown"


class VibeUsMiddleware(BaseHTTPMiddleware):
    """
    FastAPI / Starlette middleware that captures unhandled crashes, correlates
    browser/backend request IDs, and submits minimum-necessary metadata to VibeUs.
    """

    def __init__(
        self,
        app: Any,
        ingest_key: str,
        server_url: str = "https://vibeus.pro",
        service: str = "backend",
        environment: str = "production",
        release: Optional[str] = None,
        timeout: float = 3.0,
    ):
        super().__init__(app)
        self.ingest_key = ingest_key.strip()
        self.server_url = server_url.rstrip("/")
        self.service = service
        self.environment = environment
        self.release = release
        self.timeout = timeout
        # asyncio only keeps weak references to tasks. Keep a strong reference
        # until delivery finishes so a fire-and-forget event is not GC'd early.
        self._pending_tasks: set[asyncio.Task] = set()

    def _correlation_id(self, request: Request) -> str:
        incoming = (
            request.headers.get("x-vibeus-request-id")
            or request.headers.get("x-request-id")
            or request.headers.get("x-correlation-id")
        )
        if incoming and _SAFE_CORRELATION_ID.fullmatch(incoming.strip()):
            return incoming.strip()
        return uuid.uuid4().hex

    def _spawn_delivery(self, payload: dict) -> None:
        task = asyncio.create_task(self._send_error(payload))
        self._pending_tasks.add(task)
        task.add_done_callback(self._pending_tasks.discard)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        req_id = self._correlation_id(request)
        request.state.vibeus_request_id = req_id

        try:
            response = await call_next(request)
            response.headers["X-VibeUs-Request-ID"] = req_id
            return response
        except Exception as exc:
            tb = traceback.extract_tb(exc.__traceback__)
            frames = [
                {
                    "filename": _safe_filename(frame.filename),
                    "lineno": frame.lineno,
                    "function": _redact_runtime_text(frame.name, 256),
                    # Deliberately do not send source-code lines. A literal secret
                    # in source should never become observability payload.
                }
                for frame in tb[-64:]
            ]

            payload = {
                "service": _redact_runtime_text(self.service, 64),
                "exception_type": _redact_runtime_text(type(exc).__name__, 128),
                "message": _redact_runtime_text(str(exc) or type(exc).__name__, 4000),
                "route": request.url.path,
                "method": request.method,
                "status_code": 500,
                "environment": _redact_runtime_text(self.environment, 32),
                "release": _redact_runtime_text(self.release, 64) or None,
                "request_id": req_id,
                "stack": frames,
            }
            self._spawn_delivery(payload)
            # Preserve the original traceback for the host application's handlers.
            raise

    async def _send_error(self, payload: dict) -> None:
        if not httpx:
            logger.warning("httpx is required to send error telemetry to VibeUs")
            return

        endpoint = f"{self.server_url}/api/ingest/errors"
        headers = {
            "Content-Type": "application/json",
            "X-VibeUs-Ingest-Key": self.ingest_key,
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(endpoint, json=payload, headers=headers)
                if resp.status_code >= 400:
                    logger.debug("VibeUs ingest responded with status %s", resp.status_code)
        except Exception as err:
            logger.debug("Failed to deliver error telemetry to VibeUs: %s", err)
