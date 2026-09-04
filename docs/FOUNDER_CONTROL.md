# VibeUs Founder Control Center

The founder cockpit lives at `/control`. It is intentionally separate from the normal `/app` workspace RBAC.

`/control` is the read-only **Product Radar / Launch Cockpit**: the place to see product direction, confidence and the next steering intervention.

`/control/ops` is the operational **Founder Control Center**: customers, billing ledger, promos, project inspection, audit/security and operations.

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

## Product Radar / Launch Cockpit

The radar is intentionally not a vanity-metric dashboard. Its job is to answer three founder questions:

1. **Is the product producing real value?**
2. **Where is the value loop leaking?**
3. **Which intervention has priority right now?**

### North Star: Weekly Value Workspaces

The launch North Star is the number of distinct workspaces that captured at least one feedback item or runtime-error occurrence in the last 7 days.

This is preferred over DAU/MAU during launch because a login does not prove that VibeUs delivered its core value. The metric also includes a prior-week comparison and confidence based on sample size.

### Steering radar

Eight steering dimensions are shown:

- Reach;
- Activate;
- First value;
- Return;
- Deliver;
- Monetize;
- Cash & trust;
- Learn.

Radar scores are **target attainment for internal steering**, not industry benchmarks. A dimension with fewer than 10 observations is marked `insufficient` instead of producing a false red/green conclusion.

Initial launch targets are explicit and intentionally revisable as real cohorts arrive. Large pivots must not be based on low-confidence samples.

### Value loop

The radar shows the current 7-day movement through:

`signup → activated ≤24h → value workspace → captured signal → ticket → human acceptance → real payment`

The units differ across steps, so this is deliberately labeled a value loop rather than a strict cohort funnel.

### Steering Queue

The backend converts measured signals into a bounded priority queue:

- **P0** — protect money, fiscal correctness and trust before growth;
- **P1** — repair activation, time-to-value, retention or the core delivery loop;
- **P2** — improve evidence and distribution only after the core loop is credible;
- **P3** — hold course and optimize one hypothesis at a time.

Examples:

- pending/fiscal payment issues become P0;
- weak activation with a meaningful sample becomes P1 and explicitly advises against buying more acquisition;
- low repeat value becomes P1 before top-of-funnel scaling;
- falling reach only becomes a distribution problem when activation/return are already credible;
- tiny samples become an evidence task, not a product verdict.

### Launch guardrails

The radar keeps product movement separate from safety/reliability constraints:

- revenue integrity;
- consent record completeness;
- hosted VibeUs availability/latency/5xx;
- support load;
- live payment-provider contract readiness.

Customer runtime errors are **not** treated as VibeUs platform failures. Hosted platform SLO telemetry remains a visible data gap until it is actually instrumented.

Merchant/provider approval, supported geography, recurring-payment availability and fiscal contract readiness remain a **manual launch gate**. Configuration flags do not prove provider approval.

### Data confidence / instrumentation map

The cockpit shows how much of the steering system is actually observable. Currently measured server-side signals include signup, workspace/project creation, feedback, runtime errors, tickets, human acceptance, payments, promo redemption and legal consent versions.

Visible TODO blind spots include:

- landing visits and source/campaign denominator;
- onboarding step drop-off;
- authenticated feature usage;
- checkout started/abandoned;
- cancellation/churn reason;
- support contact/SLA;
- VibeUs platform latency/5xx/availability;
- VibeUs deployment/release events;
- experiment exposure/variant.

Analytics should remain privacy-light: prefer bounded first-party event names and IDs, never free-form customer content simply to make founder charts richer.

## MVP operational surfaces (`/control/ops`)

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

The operational console deliberately exposes TODO cards, not fake buttons, for:

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

The Product Radar adds explicit instrumentation TODOs alongside those feature placeholders, so the founder roadmap includes not only what to build, but also what must be measured before the next steering decision is trustworthy.

These placeholders preserve the intended product contracts while preventing unfinished money/privacy/identity mutations from appearing operational.
