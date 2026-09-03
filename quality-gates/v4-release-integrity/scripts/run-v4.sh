#!/usr/bin/env bash
set -euo pipefail
GATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="${1:-${VIBUS_PROJECT_ROOT:-}}"
SNAPSHOT="${2:-${VIBUS_REVIEW_SNAPSHOT:-}}"
if [[ -z "$PROJECT_ROOT" ]]; then
  echo "Usage: $0 /path/to/vibus [/path/to/review_snapshot.txt]" >&2
  exit 2
fi
export VIBUS_PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd)"
cd "$GATE_DIR"
python verify_integrity.py
python -m pytest -q
if [[ -n "$SNAPSHOT" ]]; then
  python scripts/verify_review_snapshot.py --repo "$VIBUS_PROJECT_ROOT" --snapshot "$SNAPSHOT"
fi
cd "$VIBUS_PROJECT_ROOT"
if [[ ! -f run_release_gate.py ]]; then
  echo "Missing root run_release_gate.py" >&2
  exit 1
fi
python run_release_gate.py
printf '\n[V4 RELEASE INTEGRITY GATE: PASS]\n'
