from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

from fastapi import HTTPException

MAX_AI_ANSWER_BYTES = 400_000
MAX_PATCH_FILES = 25

SENSITIVE_CONTEXT_KEYS = re.compile(
    r"(authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|session)",
    re.IGNORECASE,
)
SECRET_VALUE_PATTERNS = (
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]{8,}"),
    re.compile(r"\b(?:github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_\-]{12,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
    re.compile(r"(?i)\b(password|passwd|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]{6,}"),
)
HARD_PROTECTED_PATTERNS = (
    ".git/",
    ".github/workflows/",
    "deploy/",
    "id_rsa",
    "id_ed25519",
    ".pem",
    ".key",
    "credentials",
    "secrets.",
)
SHA_RE = re.compile(r"^[0-9a-f]{40}$", re.IGNORECASE)
HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


@dataclass
class ParsedHunk:
    old_start: int
    old_count: int
    new_start: int
    new_count: int
    lines: list[str] = field(default_factory=list)


@dataclass
class ParsedFilePatch:
    old_path: Optional[str]
    new_path: Optional[str]
    hunks: list[ParsedHunk] = field(default_factory=list)

    @property
    def target_path(self) -> str:
        return self.new_path or self.old_path or ""


def redact_text(value: str) -> str:
    result = value
    for pattern in SECRET_VALUE_PATTERNS:
        result = pattern.sub("[REDACTED]", result)
    return result


def sanitize_context(value: Any, *, depth: int = 0) -> Any:
    if depth > 8:
        return "[TRUNCATED]"
    if isinstance(value, dict):
        clean: dict[str, Any] = {}
        for raw_key, raw_value in list(value.items())[:100]:
            key = str(raw_key)[:200]
            clean[key] = "[REDACTED]" if SENSITIVE_CONTEXT_KEYS.search(key) else sanitize_context(raw_value, depth=depth + 1)
        return clean
    if isinstance(value, list):
        return [sanitize_context(item, depth=depth + 1) for item in value[:100]]
    if isinstance(value, str):
        return redact_text(value[:20_000])
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return redact_text(str(value)[:2_000])


def extract_patch_envelope(answer: str) -> tuple[dict[str, str], str]:
    if len(answer.encode("utf-8")) > MAX_AI_ANSWER_BYTES:
        raise HTTPException(status_code=413, detail="AI answer is too large")
    marker = "VIBEUS-PATCH v1"
    start = answer.find(marker)
    if start < 0:
        raise HTTPException(status_code=422, detail="VIBEUS-PATCH v1 envelope not found")
    patch_marker = "---PATCH---"
    end_marker = "---END PATCH---"
    patch_start = answer.find(patch_marker, start)
    patch_end = answer.find(end_marker, patch_start + len(patch_marker)) if patch_start >= 0 else -1
    if patch_start < 0 or patch_end < 0:
        raise HTTPException(status_code=422, detail="Incomplete VIBEUS-PATCH envelope")

    metadata: dict[str, str] = {}
    header = answer[start + len(marker):patch_start]
    for raw in header.splitlines():
        if ":" not in raw:
            continue
        key, value = raw.split(":", 1)
        key = key.strip().lower()
        if key in {"ticket", "repository", "base_sha"}:
            metadata[key] = value.strip()
    if not SHA_RE.fullmatch(metadata.get("base_sha", "")):
        raise HTTPException(status_code=422, detail="VIBEUS-PATCH base_sha must be a 40-character commit SHA")
    patch = answer[patch_start + len(patch_marker):patch_end].strip("\r\n")
    if not patch.startswith("diff --git "):
        raise HTTPException(status_code=422, detail="VIBEUS-PATCH must contain a unified git diff")
    return metadata, patch


def normalize_diff_path(raw: str) -> Optional[str]:
    value = raw.strip().split("\t", 1)[0].strip()
    if value == "/dev/null":
        return None
    if value.startswith("a/") or value.startswith("b/"):
        value = value[2:]
    value = value.replace("\\", "/").lstrip("/")
    parts = value.split("/")
    if not value or any(part in {"", ".", ".."} for part in parts):
        raise HTTPException(status_code=422, detail=f"Unsafe diff path: {raw}")
    return value


def parse_unified_diff(diff_text: str) -> list[ParsedFilePatch]:
    lines = diff_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    files: list[ParsedFilePatch] = []
    current: Optional[ParsedFilePatch] = None
    hunk: Optional[ParsedHunk] = None
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("diff --git "):
            hunk = None
            current = None
            i += 1
            continue
        if line.startswith("--- "):
            old_path = normalize_diff_path(line[4:])
            if i + 1 >= len(lines) or not lines[i + 1].startswith("+++ "):
                raise HTTPException(status_code=422, detail="Malformed unified diff: missing +++ path")
            new_path = normalize_diff_path(lines[i + 1][4:])
            if old_path is None and new_path is None:
                raise HTTPException(status_code=422, detail="Malformed unified diff paths")
            current = ParsedFilePatch(old_path=old_path, new_path=new_path)
            files.append(current)
            if len(files) > MAX_PATCH_FILES:
                raise HTTPException(status_code=422, detail=f"Patch may change at most {MAX_PATCH_FILES} files")
            hunk = None
            i += 2
            continue
        match = HUNK_RE.match(line)
        if match:
            if current is None:
                raise HTTPException(status_code=422, detail="Patch hunk appeared before file paths")
            hunk = ParsedHunk(
                old_start=int(match.group(1)),
                old_count=int(match.group(2) or "1"),
                new_start=int(match.group(3)),
                new_count=int(match.group(4) or "1"),
            )
            current.hunks.append(hunk)
            i += 1
            continue
        if hunk is not None:
            if line.startswith("\\ No newline at end of file"):
                i += 1
                continue
            if line.startswith((" ", "+", "-")):
                hunk.lines.append(line)
            elif line and not line.startswith(("index ", "new file mode ", "deleted file mode ")):
                raise HTTPException(status_code=422, detail=f"Unsupported line inside patch hunk: {line[:80]}")
        i += 1

    if not files or any(not item.hunks for item in files):
        raise HTTPException(status_code=422, detail="Unified diff contains no applicable hunks")
    for item in files:
        for part in item.hunks:
            old_seen = sum(1 for line in part.lines if line.startswith((" ", "-")))
            new_seen = sum(1 for line in part.lines if line.startswith((" ", "+")))
            if old_seen != part.old_count or new_seen != part.new_count:
                raise HTTPException(status_code=422, detail="Patch hunk line counts do not match its header")
    return files


def path_is_protected(path: str, configured: list[str]) -> bool:
    normalized = path.replace("\\", "/").lstrip("/").lower()
    basename = normalized.rsplit("/", 1)[-1]
    if basename == ".env" or basename.startswith(".env."):
        return True
    if any(pattern in normalized for pattern in HARD_PROTECTED_PATTERNS):
        return True
    for raw in configured:
        item = str(raw).strip().replace("\\", "/").lstrip("/").lower()
        if not item:
            continue
        if item.endswith("/") and normalized.startswith(item):
            return True
        if normalized == item or normalized.startswith(item + "/"):
            return True
        if item.endswith(".") and normalized.startswith(item):
            return True
    return False


def apply_file_patch(original: str, patch: ParsedFilePatch) -> str:
    source = original.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    trailing_newline = original.endswith(("\n", "\r"))
    if trailing_newline and source and source[-1] == "":
        source.pop()
    out: list[str] = []
    cursor = 0

    for hunk in patch.hunks:
        start = max(hunk.old_start - 1, 0)
        if start < cursor or start > len(source):
            raise HTTPException(status_code=409, detail=f"Patch context no longer matches {patch.target_path}")
        out.extend(source[cursor:start])
        cursor = start
        for raw in hunk.lines:
            prefix, text = raw[0], raw[1:]
            if prefix == " ":
                if cursor >= len(source) or source[cursor] != text:
                    raise HTTPException(status_code=409, detail=f"Patch context no longer matches {patch.target_path}")
                out.append(text)
                cursor += 1
            elif prefix == "-":
                if cursor >= len(source) or source[cursor] != text:
                    raise HTTPException(status_code=409, detail=f"Patch deletion no longer matches {patch.target_path}")
                cursor += 1
            elif prefix == "+":
                out.append(text)
        
    out.extend(source[cursor:])
    result = "\n".join(out)
    if trailing_newline and result:
        result += "\n"
    return result
