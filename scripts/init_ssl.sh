#!/usr/bin/env bash
# Provision a Let's Encrypt certificate for PUBLIC_BASE_URL and PREVIEW_BASE_URL.
# The production and preview hosts are deployment configuration, never hardcoded here.
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DATA_PATH="${CERTBOT_DATA_PATH:-./certbot}"
RSA_KEY_SIZE="${CERTBOT_RSA_KEY_SIZE:-4096}"
CERTBOT_STAGING="${CERTBOT_STAGING:-0}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found." >&2
  exit 2
fi

read_env_value() {
  python3 - "$ENV_FILE" "$1" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
key = sys.argv[2]
for raw in path.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, value = line.split("=", 1)
    if k.strip() == key:
        print(value.strip().strip('"').strip("'"))
        break
PY
}

url_host() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlsplit
url = sys.argv[1].strip()
parsed = urlsplit(url)
if parsed.scheme not in {"http", "https"} or not parsed.hostname:
    raise SystemExit(f"invalid URL: {url}")
print(parsed.hostname)
PY
}

PUBLIC_BASE_URL="$(read_env_value PUBLIC_BASE_URL)"
PREVIEW_BASE_URL="$(read_env_value PREVIEW_BASE_URL)"

if [[ -z "$PUBLIC_BASE_URL" || -z "$PREVIEW_BASE_URL" ]]; then
  echo "ERROR: PUBLIC_BASE_URL and PREVIEW_BASE_URL are required in $ENV_FILE." >&2
  exit 2
fi

PUBLIC_HOST="$(url_host "$PUBLIC_BASE_URL")"
PREVIEW_HOST="$(url_host "$PREVIEW_BASE_URL")"

if [[ "$PUBLIC_HOST" == "$PREVIEW_HOST" ]]; then
  echo "ERROR: preview and account hosts must differ." >&2
  exit 2
fi

DOMAINS=("$PUBLIC_HOST" "$PREVIEW_HOST")
PRIMARY_DOMAIN="$PUBLIC_HOST"
LIVE_DIR="$DATA_PATH/conf/live/$PRIMARY_DOMAIN"

if [[ -d "$LIVE_DIR" && "${CERTBOT_FORCE_REPLACE:-0}" != "1" ]]; then
  echo "ERROR: certificate data already exists for $PRIMARY_DOMAIN." >&2
  echo "Set CERTBOT_FORCE_REPLACE=1 only when you intentionally want to replace it." >&2
  exit 2
fi

mkdir -p "$DATA_PATH/conf" "$DATA_PATH/www"

if [[ ! -e "$DATA_PATH/conf/options-ssl-nginx.conf" || ! -e "$DATA_PATH/conf/ssl-dhparams.pem" ]]; then
  echo "Downloading Certbot TLS parameter files..."
  curl -fsSL https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
    -o "$DATA_PATH/conf/options-ssl-nginx.conf"
  curl -fsSL https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem \
    -o "$DATA_PATH/conf/ssl-dhparams.pem"
fi

LE_PATH="/etc/letsencrypt/live/$PRIMARY_DOMAIN"
mkdir -p "$LIVE_DIR"

echo "Creating temporary certificate for $PRIMARY_DOMAIN..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm --entrypoint openssl certbot \
  req -x509 -nodes -newkey "rsa:$RSA_KEY_SIZE" -days 1 \
  -keyout "$LE_PATH/privkey.pem" \
  -out "$LE_PATH/fullchain.pem" \
  -subj "/CN=localhost"

echo "Starting nginx for ACME challenge..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up --force-recreate -d nginx

echo "Removing temporary certificate..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm --entrypoint rm certbot \
  -rf "/etc/letsencrypt/live/$PRIMARY_DOMAIN" "/etc/letsencrypt/archive/$PRIMARY_DOMAIN" "/etc/letsencrypt/renewal/$PRIMARY_DOMAIN.conf"

CERT_ARGS=(certonly --webroot -w /var/www/certbot --rsa-key-size "$RSA_KEY_SIZE" --agree-tos --force-renewal)
if [[ -n "$CERTBOT_EMAIL" ]]; then
  CERT_ARGS+=(--email "$CERTBOT_EMAIL")
else
  CERT_ARGS+=(--register-unsafely-without-email)
fi
if [[ "$CERTBOT_STAGING" != "0" ]]; then
  CERT_ARGS+=(--staging)
fi
for domain in "${DOMAINS[@]}"; do
  CERT_ARGS+=(-d "$domain")
done

echo "Requesting Let's Encrypt certificate for: ${DOMAINS[*]}"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm --entrypoint certbot certbot "${CERT_ARGS[@]}"

echo "Reloading nginx..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec nginx nginx -s reload

echo "Certificate successfully issued for: ${DOMAINS[*]}"
