# 🛠️ Self-Hosting VibeUs

VibeUs can be fully self-hosted on your own virtual server (VPS) or local infrastructure.

---

## 1. Architecture Overview

A self-hosted VibeUs instance consists of:
- **`openspec-core`**: FastAPI Python backend (REST API, WebSocket sync multiplexer, Live Preview proxy).
- **`openspec-web`**: React 19 web application (landing, `/app` dashboard, project board) and the standalone embeddable widget (`vibus-widget.umd.cjs`).
- **`openspec-cli`**: Node.js CLI tool for developers (`npx vibus listen`, tunnel connectors).
- **Database**: PostgreSQL 15+ (production recommended) or SQLite with async driver.

> ⚠️ **Worker Architecture:** Backend **must** run with a single Uvicorn worker (`--workers 1`). WebSocket sync and Live Preview reverse proxy maintain state in process memory.

---

## 2. Quick Start with Docker Compose

The fastest way to deploy a complete stack:

```bash
git clone https://github.com/AlexeyPlaton/Vibus.git vibeus
cd vibeus
cp .env.example .env
docker compose up -d --build
```

Your self-hosted instance will be available at `http://localhost:8000`.

---

## 3. Required Environment Variables & Security Keys

In production, generate cryptographic secrets before starting the server. Never use defaults in production!

```bash
# Generate 64-char hex strings:
openssl rand -hex 32
```

| Variable | Required | Description | Example |
| :--- | :---: | :--- | :--- |
| `SECRET_KEY` | **Yes** | Session signature and JWT signing key | `openssl rand -hex 32` |
| `TOKEN_PEPPER` | **Yes** | Server pepper for API tokens and passwords | `openssl rand -hex 32` |
| `FIELD_ENCRYPTION_KEY` | **Yes** | Fernet / AES key for sensitive database columns | `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `DATABASE_URL` | **Yes** | Async SQLAlchemy DB URL | `sqlite+aiosqlite:///./vibus.db` or `postgresql+asyncpg://user:pass@127.0.0.1:5432/vibeus` |
| `CORS_ORIGINS` | **Yes** | Allowed web app and API origins | `https://vibeus.example.com` |
| `ENVIRONMENT` | **Yes** | Environment tag (`production`, `staging`, `development`) | `production` |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram bot token for instant task notifications | `123456:ABC-DEF...` |

---

## 4. Manual Setup (Bare Metal / Ubuntu)

### Backend (`openspec-core`)
```bash
cd openspec-core
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run database migrations
alembic upgrade head

# Start server (Strictly 1 worker!)
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

### Frontend & Widget Build (`openspec-web`)
The web application and embeddable widget must be built with Vite:

```bash
cd openspec-web
npm install
# Builds both SPA and the standalone static widget:
npm run build:all
```

`npm run build:all` builds the standalone widget and landing/app bundle; `build:widget` also synchronizes the verified widget artifacts into `openspec-core/static/`. Production Nginx should serve the built web bundle and proxy API/WebSocket traffic to port `8000`. Live Preview must use a separate registrable domain from the account application.

---

## 5. Systemd Service Example (`/etc/systemd/system/vibeus.service`)

```ini
[Unit]
Description=VibeUs Cloud Backend
After=network.target

[Service]
User=admin
WorkingDirectory=/var/www/vibeus/openspec-core
EnvironmentFile=/var/www/vibeus/.env
ExecStart=/var/www/vibeus/openspec-core/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

---

## 6. Updating

To update a self-hosted instance:
```bash
git pull origin main
cd openspec-core
venv/bin/alembic upgrade head
cd ../openspec-web
npm run build:all
sudo systemctl restart vibeus
```
