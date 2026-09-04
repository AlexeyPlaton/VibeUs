# VibeUs Founder Control Center

The founder console lives at `/control`. It is intentionally separate from the normal `/app` workspace RBAC.

## Enable it

The backend is fail-closed by default:

```env
ENABLE_CONTROL_CENTER=true
PLATFORM_ADMIN_EMAILS=founder@example.com
CONTROL_ELEVATION_MINUTES=15
```

`PLATFORM_ADMIN_EMAILS` is an explicit comma-separated allow-list. Workspace `owner` or `admin` roles never grant platform-control access.

In production, enabling the Control Center without at least one explicit admin email is a configuration error. Wildcards are rejected.

## Security model

Read operations require:

1. a valid VibeUs user session/bearer token;
2. an email in `PLATFORM_ADMIN_EMAILS`;
3. `ENABLE_CONTROL_CENTER=true`.

Sensitive mutations additionally require a short-lived password re-authentication through `POST /api/control/elevate`. The backend issues a signed HttpOnly `SameSite=Strict` elevation cookie scoped to `/api/control`.

Sensitive actions include:

- block/unblock a user;
- revoke user sessions;
- manual entitlement grant;
- create/activate/deactivate promo codes;
- revoke project API/ingest credentials.

Every sensitive action writes an `admin.*` audit event with actor, target and reason.

The console never returns project API tokens, ingest keys, provider API secrets, token pepper or field-encryption material. The public widget key is deliberately browser-visible and may be shown.

## MVP surfaces

### Overview

Shows users, workspace/project counts, paid workspaces, payment/fiscal attention, runtime-error attention, promo redemption activity and 30-day net revenue by currency.

### Customers

Search by email, user/workspace/project ID, workspace name and project slug. Inspect user state, workspace membership, projects, legal-consent versions and active-session count. Platform admins can block/unblock a user or revoke sessions after step-up authentication.

### Billing

Lists the local payment ledger, refund totals and fiscal state. A founder can grant time-limited access using an internal one-use entitlement path. This does not fabricate a payment and does not overwrite the payment provider.

Provider-side refund/cancellation initiation is intentionally not faked. The UI keeps it as an explicit TODO until the canonical live billing adapter implements a verified remote provider mutation.

### Promo Center

Create a generated or custom promo with:

- Solo / Studio / Business tier;
- duration or lifetime;
- campaign;
- maximum uses;
- optional expiry.

The plaintext code is returned exactly once. VibeUs stores only its digest. The console also returns a ready-to-share `/create?promo=...` link.

Existing promos can be activated/deactivated after step-up authentication. Usage and recent redemptions are visible without revealing the original code.

### Project Inspector

Shows non-secret project state, public widget key, origin allow-list, runtime/telemetry status, GitHub integration state, feedback/ticket/error counts and recent runtime errors.

Secret API/ingest values are never rendered. A platform admin may revoke them without learning their value.

### Security & Audit

Displays the audit ledger and the Control Center security contract. Platform administration is intentionally isolated from workspace roles.

### Operations

Shows DB readiness, runtime version/environment, billing-provider enablement flags, payment/fiscal attention and open runtime errors. Secrets are never returned.

## Post-MVP placeholders

The `/control` UI deliberately exposes TODO cards, not fake buttons, for:

- Customer 360 timeline;
- internal support notes and tags;
- cross-project Error Center;
- payment reconciliation;
- privacy export/deletion/anonymisation workflows;
- cohort retention, funnel, LTV, churn and promo ROI;
- feature flags;
- announcements;
- read-only "View as customer";
- platform-admin passkey/MFA;
- founder shortcuts;
- provider-side refund and recurring-cancellation adapters.

These placeholders preserve the intended product contracts while preventing unfinished money/privacy/identity mutations from appearing operational.
