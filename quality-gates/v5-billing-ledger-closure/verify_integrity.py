from __future__ import annotations

import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "manifest.sha256"


def main() -> int:
    expected = {}
    for raw in MANIFEST.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("#"):
            continue
        digest, rel = raw.split(None, 1)
        expected[rel.strip()] = digest
    errors = []
    for rel, digest in expected.items():
        path = ROOT / rel
        if not path.is_file():
            errors.append(f"missing: {rel}")
            continue
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != digest:
            errors.append(f"modified: {rel}")
    if errors:
        print("V5 GATE INTEGRITY: FAIL")
        for item in errors:
            print(f"- {item}")
        return 1
    print(f"V5 GATE INTEGRITY: PASS ({len(expected)} protected files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
