#!/usr/bin/env bash
# VibeUs self-host deployment helper.
# This script intentionally does not hardcode the hosted vibeus.pro operator domain.
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy deploy/env.production.example and fill real values first." >&2
  exit 2
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree is dirty; refusing to deploy an ambiguous source state." >&2
  exit 2
fi

HEAD="$(git rev-parse HEAD)"
echo "Deploying exact commit: $HEAD"

echo "[1/4] Installing web dependencies and building web + widget..."
pushd openspec-web >/dev/null
npm ci
npm run build:all
popd >/dev/null

echo "[2/4] Applying production compose configuration..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build --remove-orphans

echo "[3/4] Waiting for services..."
sleep 5

echo "[4/4] Container status:"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo
echo "Deployment completed for commit $HEAD."
echo "Verify PUBLIC_BASE_URL/health, PUBLIC_BASE_URL/ready, and PREVIEW_BASE_URL using the values in $ENV_FILE."
