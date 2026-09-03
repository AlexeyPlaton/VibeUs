# VibeUs production deployment

This guide documents the supported production shape for a self-hosted VibeUs instance.

## 1. Security boundary: account origin != preview origin

VibeUs serves two different trust zones:

1. **Account / API origin** — authenticated workspace UI, API, billing and normal WebSocket traffic.
2. **Live Preview origin** — untrusted HTML proxied from a developer's local machine.

In production they must use **different registrable domains**.

Example:

```text
PUBLIC_BASE_URL=https://vibeus.example.com
PREVIEW_BASE_URL=https://preview.example.net
```

Do **not** use `preview.vibeus.example.com` when the authenticated application is on `vibeus.example.com`, and do not point a wildcard such as `*.vibeus.example.com` at the preview gateway. The preview boundary exists specifically so arbitrary preview content cannot share the account site's cookie/origin trust boundary.

Configure DNS only for the exact hosts you deploy, for example:

| Type | Host | Value |
|---|---|---|
| A/AAAA | `vibeus.example.com` | your server address |
| A/AAAA | `preview.example.net` | your server address |

The reference reverse-proxy split is documented in `deploy/nginx-preview.example.conf`.

## 2. Current scaling rule

The current realtime and Live Preview connection registries are process-local. Run exactly **one VibeUs application worker** until distributed connection/tunnel routing is implemented.

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

Do not horizontally scale application workers behind a load balancer yet.

## 3. Prepare the host

The helper script supports Ubuntu 22.04/24.04 and Debian 11/12:

```bash
chmod +x scripts/setup_vps.sh
./scripts/setup_vps.sh
```

It installs Docker tooling, configures the basic firewall, creates Certbot directories and copies the maintained production environment template when `.env.production` does not exist.

## 4. Configure production environment

Copy the maintained template:

```bash
cp deploy/env.production.example .env.production
```

Then set the real values for your deployment. At minimum review:

```text
PUBLIC_BASE_URL
PREVIEW_BASE_URL
CORS_ORIGINS
DATABASE_URL
TOKEN_PEPPER
FIELD_ENCRYPTION_KEY
```

Generate independent random values for cryptographic secrets. Do not commit `.env.production`.

Billing configuration is deployment-specific. Do not enable a payment provider, market or tax mode unless your merchant/legal setup actually supports it.

## 5. TLS certificates

`init_ssl.sh` reads the public and preview hostnames from `.env.production`; it does not contain a hardcoded VibeUs production domain.

Set a real Certbot contact email in the environment:

```bash
export CERTBOT_EMAIL=admin@example.com
chmod +x scripts/init_ssl.sh
./scripts/init_ssl.sh
```

Use `CERTBOT_STAGING=1` while testing repeated certificate provisioning.

Both DNS names must already resolve to the server and the ACME webroot must be reachable before requesting certificates.

## 6. Build, verify and deploy

Before deployment, run the repository's official release gate from a correctly provisioned development/CI environment:

```bash
python run_release_gate.py
```

Build the frontend/widget and start production containers:

```bash
cd openspec-web
npm ci
npm run build:all
cd ..

docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build --remove-orphans
```

Check:

```text
< PUBLIC_BASE_URL >/health
< PUBLIC_BASE_URL >/ready
```

The exact public URLs come from your `.env.production`; deployment scripts must not assume `vibeus.pro` or any other operator-owned domain.

## 7. Updates

For a self-hosted installation, pull a reviewed release, rebuild, apply migrations and restart using your normal deployment process. Never deploy an arbitrary moving branch directly to production without first running the release gate for the exact commit being deployed.

## 8. Hosted VibeUs vs self-hosting

The public `vibeus.pro` service has its own operator, payment, legal and data-localization configuration. Those hosted-service choices are **not** defaults for third-party self-hosted installations. Self-hosters are responsible for their own domain, infrastructure, legal notices, data locations, subprocessors and payment configuration.
