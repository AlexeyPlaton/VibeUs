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
  python scripts/verify_delivered_snapshot.py --snapshot "$SNAPSHOT"
fi
V4="$VIBUS_PROJECT_ROOT/quality-gates/v4-release-integrity/scripts/run-v4.sh"
if [[ ! -f "$V4" ]]; then
  echo "Missing V4 runner: $V4" >&2
  exit 1
fi
bash "$V4" "$VIBUS_PROJECT_ROOT" "$SNAPSHOT"
printf '\n[V5 BILLING LEDGER CLOSURE: PASS]\n'
