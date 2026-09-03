#!/usr/bin/env bash
set -e

echo "Running database migrations..."
alembic upgrade head

echo "Starting Uvicorn..."
# Realtime and tunnel connection registries are process-local in this release.
# Reject an explicit multi-worker launch rather than silently splitting clients.
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  if [[ "${args[$i]}" == "--workers" ]]; then
    next=$((i + 1))
    if [[ $next -lt ${#args[@]} && "${args[$next]}" != "1" ]]; then
      echo "ERROR: VibeUs currently supports exactly one application worker." >&2
      exit 64
    fi
  fi
done
if [[ "${WEB_CONCURRENCY:-1}" != "1" ]]; then
  echo "ERROR: WEB_CONCURRENCY must be 1 until realtime/tunnel state is distributed." >&2
  exit 64
fi
exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1 --proxy-headers --forwarded-allow-ips "*" "${args[@]}"
