#!/usr/bin/env bash
set -euo pipefail
GATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="${1:-${VIBUS_PROJECT_ROOT:-}}"
if [[ -z "$PROJECT_ROOT" ]]; then
  echo "Usage: $0 /path/to/openspec" >&2
  exit 2
fi
export VIBUS_PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd)"
cd "$GATE_DIR"
python verify_integrity.py
python -m pytest tests
node --test tests-js/*.test.mjs
cd "$VIBUS_PROJECT_ROOT/openspec-web"
npm run build:all
printf '\nv3.3.2 PASS: 12/12 pytest + 3/3 Node + build:all\n'
