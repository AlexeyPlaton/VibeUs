# Self-Hosting VibeUs

VibeUs can be self-hosted on a local machine, private infrastructure, or a VPS.

For product support and questions about these instructions, use **support@vibeus.pro**.

---

## 1. Architecture overview

A self-hosted VibeUs instance consists of:

- **`openspec-core`** — FastAPI backend: REST API, WebSocket sync, billing adapters and Live Preview proxy.
- **`openspec-web`** — React web application: landing, `/app` dashboard, project board and standalone widget.
- **`openspec-cli`** — Node.js CLI for developer workflows (`npx vibus listen`, MCP and tunnel commands).
- **Database** — PostgreSQL 15+ for production; SQLite is supported for development/tests only.
- **Nginx** — serves the built SPA and proxies API/WebSocket traffic in the reference Compose stack.

> **Current worker rule:** run exactly one Uvicorn application worker. WebSocket sync and Live Preview routing still keep active connection state in process memory.

---

## 2. Local quick start with Docker Compose

### Prerequisites

- Docker with Compose v2;
- Node.js 20+ (CI currently uses Node.js 22);
- npm.

The reference `docker-compose.yml` mounts the already-built frontend and widget from `openspec-web/dist-landing` and `openspec-web/dist-widget`. A clean clone therefore needs the frontend build **before** starting Compose.

```bash
git clone https://github.com/AlexeyPlaton/VibeUs.git vibeus
cd vibeus
cp .env.example .env

cd openspec-web
npm ci
npm run build:all
cd ..

docker compose up -d --build
```

Local endpoints in the reference Compose stack:

- Web UI: `http://localhost`
- API direct: `http://localhost:8000`
- API readiness: `http://localhost:8000/ready`
- PostgreSQL exposed to the host: `localhost:5433`

Useful checks:

```bash
docker compose ps
curl -fsS http://localhost:8000/ready
```

The root `.env.example` is a development template. Do not treat its placeholder values as production secrets.

---

## 3. Production configuration

For a production deployment, start from the maintained production template rather than the development `.env`:

```bash
cp deploy/env.production.example .env.production
```

The backend fails closed on important production invariants. At minimum configure and review:

| Variable | Requirement |
| --- | --- |
| `ENVIRONMENT` | `production` |
| `DATABASE_URL` | PostgreSQL; SQLite is rejected in production |
| `TOKEN_PEPPER` | Independent high-entropy secret, at least 32 random bytes |
| `FIELD_ENCRYPTION_KEY` | Independent production encryption key |
| `CORS_ORIGINS` | Explicit trusted origins; wildcard `*` is rejected |
| `PUBLIC_BASE_URL` | Authenticated account/API origin |
| `PREVIEW_BASE_URL` | A **different host and different registrable-domain boundary** from `PUBLIC_BASE_URL` |
| `ENABLE_DEMO_SEED` | `false` |
| `ENABLE_MOCK_BILLING` | `false` |

Generate secrets independently. For example:

```bash
openssl rand -hex 32
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

There is no required `SECRET_KEY` setting in the current backend configuration; do not invent one from older deployment notes.

Payment providers are also fail-closed. Keep a provider disabled until the corresponding merchant account, credentials, webhook configuration and fiscal/legal setup are actually ready. The canonical hosted international path is prepared for CloudPayments but remains disabled by default.

See `docs/PRODUCTION_DEPLOYMENT.md` for the production reverse-proxy, TLS and deployment boundary.

---

## 4. Manual development setup

### Backend

Python 3.12 is the CI/reference version.

```bash
cd openspec-core
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m alembic upgrade head
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
```

On Windows PowerShell, activate the virtual environment with:

```powershell
.\.venv\Scripts\Activate.ps1
```

### Frontend

In a second terminal:

```bash
cd openspec-web
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://localhost:5173`. During local development the frontend talks to the backend on `http://localhost:8000`.

To build the production SPA and standalone widget:

```bash
npm run build:all
```

`build:widget` also synchronizes the verified widget artifacts into `openspec-core/static/`.

---

## 5. Production worker and origin isolation

Until distributed realtime/tunnel state is implemented, keep the backend at one Uvicorn worker:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

Live Preview serves untrusted developer content and must not share the authenticated account's registrable-domain cookie boundary. For example:

```text
PUBLIC_BASE_URL=https://vibeus.example.com
PREVIEW_BASE_URL=https://preview.example.net
```

Do not use `preview.vibeus.example.com` for this boundary.

---

## 6. Updating

For a reviewed release:

```bash
git pull origin main
cd openspec-web
npm ci
npm run build:all
cd ..
python run_release_gate.py

docker compose up -d --build
```

For production, use the maintained production Compose/deployment flow documented in `docs/PRODUCTION_DEPLOYMENT.md`, apply migrations for the exact release and verify `/ready` before routing traffic.

---

## 7. Support

General product and self-hosting support: **support@vibeus.pro**.

For a suspected security vulnerability, do not publish secrets or customer data in a public issue; follow `SECURITY.md`.
