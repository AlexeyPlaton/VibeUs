# VibeUs Cloud API Reference

## Base URLs
- **Production**: `https://vibeus.pro`
- **Development**: `http://localhost:8000`

---

## Authentication & Security

VibeUs enforces strict multi-tenant isolation, cryptographically hashed tokens at rest, and CSRF defense:

### 1. Browser Authentication (Dashboard & Web App)
- **Login**: `POST /api/auth/browser-login`
- Sets a secure, `HttpOnly`, `SameSite=Lax` cookie (`vibeus_session`).
- **CSRF Protection**: Any state-changing HTTP request (`POST`, `PATCH`, `DELETE`, `PUT`) authenticated via ambient session cookie **must** provide a trusted `Origin` header matching the deployed domain. Requests without a trusted `Origin` receive `HTTP 403 CSRF_ORIGIN_REJECTED`.

### 2. Bearer Authentication (CLI & API Clients)
- Pass the session token in the header:
  ```http
  Authorization: Bearer <access_token>
  ```

### 3. Project Secret API Tokens
- Used by CLI tools and backend automations:
  ```http
  X-API-Token: vb_live_<random_hex>
  ```
  > 🔒 **Single-Exposure Security**: Secret API tokens are displayed **only once** upon project creation or regeneration. The backend stores only salted SHA-256 / Argon2id digests. Repeated `GET` requests never return the secret token.

### 4. Public Widget Keys
- Used by client-side feedback widgets:
  ```http
  X-Public-Widget-Key: vb_pub_<random_hex>
  ```
- Public keys are persistent, rotatable in the dashboard, and validated against the project's allowed origins (`allowed_origins`).

---

## Subscription Quotas & Limits

| Tier | Active Projects Quota | Validity Period | Renewal |
| :--- | :---: | :---: | :---: |
| **Free** | 1 project | Unlimited | Default |
| **Solo** | 10 projects | 30 calendar days | Manual / Invoice |
| **Studio** | 50 projects | 30 calendar days | Manual / Invoice |

> 💡 **Pre-creation Payment**: Paid projects (Solo/Studio) require an active workspace tier or completing checkout before the project is provisioned. Unsuccessful payments never consume slots or create orphaned projects.

### Canonical pricing catalog

Numeric paid prices are intentionally **not duplicated in this API reference**. Runtime pricing comes from deployment environment variables and is exposed by:

- `GET /api/public/pricing` — unauthenticated, read-only catalog used by the landing page, project creation flow, and workspace dashboard.
- `PRICE_RUB_SOLO`, `PRICE_RUB_STUDIO` — Russia / YooKassa prices.
- `PRICE_USD_SOLO`, `PRICE_USD_STUDIO` — International prices (visible only when explicitly enabled).
- `BILLING_PERIOD_DAYS` — paid access period.
- `PRICING_DEFAULT_MARKET`, `ENABLE_GLOBAL_PRICING` — presentation/deployment switches.

Repository pricing documentation is generated from the selected env file with `python scripts/render_pricing.py --env-file <env-file>`. This prevents a frontend/docs amount from silently diverging from the amount charged by the backend.

---

## Endpoints

### 1. System & Health

#### Root Info
- **Method:** `GET /`
- **Auth Required:** No
- **Response:**
  ```json
  {
    "name": "VibeUs API",
    "version": "1.0.0",
    "docs_url": "/docs"
  }
  ```

#### Health Check
- **Method:** `GET /health`
- **Auth Required:** No
- **Response:**
  ```json
  {
    "status": "ok",
    "environment": "production"
  }
  ```

---

### 2. Authentication

#### Register
- **Method:** `POST /api/auth/register`
- **Auth Required:** No
- **Request Body:**
  ```json
  {
    "email": "dev@example.com",
    "password": "SecurePassword123!",
    "accept_terms": true,
    "terms_version": "2026-08-31",
    "privacy_version": "2026-08-31"
  }
  ```
- **Response:** `200 OK` with user profile.

#### Browser Login
- **Method:** `POST /api/auth/browser-login`
- **Auth Required:** No
- **Request Body:**
  ```json
  {
    "email": "dev@example.com",
    "password": "SecurePassword123!"
  }
  ```
- **Response:** `200 OK` (Sets `HttpOnly` session cookie).

#### Token Login (CLI / API)
- **Method:** `POST /api/auth/login`
- **Auth Required:** No
- **Response:**
  ```json
  {
    "access_token": "vb_sess_...",
    "token_type": "bearer",
    "user": { "id": "uuid", "email": "dev@example.com" }
  }
  ```

#### Logout
- **Method:** `POST /api/auth/logout`
- **Auth Required:** Yes
- **Response:** Revokes current session token and clears cookies.

---

### 3. Workspaces

#### List User Workspaces
- **Method:** `GET /api/workspaces`
- **Auth Required:** Yes (Session or Bearer)
- **Response:**
  ```json
  [
    {
      "id": "ws_12345",
      "name": "My Agency",
      "tier": "solo",
      "projects_count": 3,
      "max_projects": 10,
      "tier_expires_at": "2026-10-01T12:00:00Z",
      "created_at": "2026-09-01T10:00:00Z"
    }
  ]
  ```

#### Create Workspace
- **Method:** `POST /api/workspaces`
- **Auth Required:** Yes
- **Request Body:**
  ```json
  {
    "name": "New Workspace"
  }
  ```
- **Response:** `200 OK` with created workspace. The creating user is automatically assigned as `owner`.

#### Get Workspace Dashboard Details
- **Method:** `GET /api/workspaces/{id}/summary`
- **Auth Required:** Yes
- **Response:** Workspace metadata plus effective tier and project quota summary. Use `GET /api/workspaces/{id}/projects` for the project list.

---

### 4. Projects & Keys Lifecycle

#### Create Project
- **Method:** `POST /api/projects`
- **Auth Required:** Yes
- **Request Body:**
  ```json
  {
    "name": "Client Portal",
    "slug": "client-portal",
    "workspace_id": "ws_12345",
    "origins": ["https://client.example.com"]
  }
  ```
- **Response:** `200 OK`
  ```json
  {
    "id": "proj_abc123",
    "name": "Client Portal",
    "slug": "client-portal",
    "workspace_id": "ws_12345",
    "public_widget_key": "vb_pub_9a8b7c6d5e...",
    "token": "vb_live_f1e2d3c4b5a...",
    "created_at": "2026-09-01T12:00:00Z"
  }
  ```
  > ⚠️ Store the secret `token` immediately! It will never be returned in plaintext again.

> Runtime Error Tracking uses a separate `vb_ingest_...` secret. It is also one-time-view and stored only as a digest. Rotate it from the workspace dashboard if lost.

#### Get Project
- **Method:** `GET /api/projects/{slug}`
- **Auth Required:** Yes (Owner, Workspace Member, or X-API-Token)
- **Response:** Returns project metadata. Notice `token` is omitted:
  ```json
  {
    "id": "proj_abc123",
    "name": "Client Portal",
    "slug": "client-portal",
    "public_widget_key": "vb_pub_9a8b7c6d5e...",
    "token_preview": "vb_live_...4b5a",
    "has_secret_token": true
  }
  ```

#### Rotate Secret API Token
- **Method:** `POST /api/workspaces/{workspace_id}/projects/{slug}/rotate-api-token`
- **Auth Required:** Yes (Workspace Owner)
- **Response:**
  ```json
  {
    "token": "vb_live_newsecret123...",
    "rotated_at": "2026-09-01T14:30:00Z"
  }
  ```

#### Get / Copy Public Widget Key
- **Method:** `GET /api/workspaces/{workspace_id}/projects`
- **Auth Required:** Yes
- **Response:**
  ```json
  {
    "public_widget_key": "vb_pub_9a8b7c6d5e...",
    "token_last_rotated_at": "2026-09-01T14:30:00Z"
  }
  ```

#### Rotate Public Widget Key
- **Method:** `POST /api/workspaces/{workspace_id}/projects/{slug}/rotate-public-key`
- **Auth Required:** Yes
- **Response:**
  ```json
  {
    "public_widget_key": "vb_pub_newpublickey...",
    "rotated_at": "2026-09-01T14:35:00Z"
  }
  ```

#### Delete Project
- **Method:** `DELETE /api/workspaces/{workspace_id}/projects/{slug}?confirmation_slug={slug}`
- **Auth Required:** Yes (`workspace:manage`)
- **Response:** `200 OK` with `{"success": true}`. Frees project slot in workspace.

---

### 5. Tickets, Feedback & Live Boards

#### Submit Feedback (Widget)
- **Method:** `POST /api/projects/{slug}/feedback`
- **Auth Required:** No (Validated via Public Widget Key and Request Origin)
- **Headers:**
  ```http
  X-Public-Widget-Key: vb_pub_9a8b7c6d5e...
  ```
- **Request Body:**
  ```json
  {
    "text": "The checkout button is unaligned on mobile view",
    "element_selector": "#checkout-btn",
    "route": "/cart",
    "viewport": { "width": 375, "height": 812 },
    "author_name": "Reviewer"
  }
  ```

#### Get Project Board & Tickets
- **Method:** `GET /api/projects/{slug}/board`
- **Auth Required:** Yes (Owner, Member, or Access Link)
- **Response:** Complete ticket hierarchy, status columns, discussions, and definition of done (DoD).

#### Update Ticket
- **Method:** `PUT /api/projects/{slug}/tickets/{ticket_id}`
- **Auth Required:** Yes
- **Criteria Contract v2.1:** `checklists` stores implementation claims; `criteria_contract` stores the structured requirement; `criteria_evidence` is read-only server state. In Strict/Critical mode a BLOCKER/HIGH criterion must have verified evidence before the ticket can enter Review.
- **Request Body:**
  ```json
  {
    "status": "done",
    "expected_revision": 4
  }
  ```

---

### 6. Live Preview Tunnels

#### Create Tunnel Session
- **Method:** `POST /api/projects/{slug}/tunnels`
- **Auth Required:** Yes (CLI with API Token or Owner)
- **Request Body:**
  ```json
  {
    "target_port": 3000,
    "ttl": "24h"
  }
  ```
- **Response:**
  ```json
  {
    "tunnel_id": "tun_xyz789",
    "preview_url": "https://preview.vibeus-preview.net/preview/tun_xyz789/#vibus_token=...",
    "expires_at": "2026-09-02T12:00:00Z"
  }
  ```

---

### 7. Billing & Payments

#### Create YooKassa Checkout Session
- **Method:** `POST /api/billing/yookassa/create-payment`
- **Auth Required:** Yes
- **Request Body:**
  ```json
  {
    "tier": "solo",
    "workspace_id": "ws_12345",
    "return_url": "https://vibeus.pro/app"
  }
  ```
- **Response:**
  ```json
  {
    "confirmation_url": "https://yookassa.ru/checkout/...",
    "payment_id": "pay_987654"
  }
  ```

#### Webhook Handler
- **Method:** `POST /api/billing/yookassa/webhook`
- **Auth Required:** Signature validation via `YOOKASSA_SECRET_KEY`
- **Description:** Idempotently processes payment capture and extends workspace tier for 30 calendar days.
