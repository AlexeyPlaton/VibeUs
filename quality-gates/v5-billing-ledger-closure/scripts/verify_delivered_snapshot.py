from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path


CRITICAL_MARKERS = {
    "openspec-core/Dockerfile",
    "run_release_gate.py",
    "scripts/render_pricing.py",
}


def parse_markers(text: str) -> set[str]:
    return set(re.findall(r"^--- Файл: (.+?) ---\s*$", text, re.M))


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Verify the exact review artifact being handed to the auditor and print its SHA-256."
    )
    ap.add_argument("--snapshot", required=True, type=Path)
    args = ap.parse_args()
    raw = args.snapshot.read_bytes()
    text = raw.decode("utf-8-sig", errors="strict")
    digest = hashlib.sha256(raw).hexdigest()

    errors = []
    first_lines = "\n".join(text.splitlines()[:40])
    head_match = re.search(r"^--- GIT HEAD: ([0-9a-f]{40}) ---\s*$", first_lines, re.M)
    if not head_match:
        errors.append("missing top-level --- GIT HEAD: <40hex> --- within first 40 lines")
    if not re.search(r"^--- GIT DIRTY: false ---\s*$", first_lines, re.M):
        errors.append("missing top-level --- GIT DIRTY: false --- within first 40 lines")

    markers = parse_markers(text)
    for required in sorted(CRITICAL_MARKERS):
        if required not in markers:
            errors.append(f"missing exact file marker: {required}")
    if "openspec-core/dockerfile" in markers:
        errors.append("lowercase openspec-core/dockerfile marker present")

    print(f"DELIVERED SNAPSHOT SHA256: {digest}")
    if head_match:
        print(f"DELIVERED SNAPSHOT GIT HEAD: {head_match.group(1)}")
    if errors:
        print("DELIVERED SNAPSHOT: FAIL")
        for error in errors:
            print(f"- {error}")
        return 1
    print("DELIVERED SNAPSHOT: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
