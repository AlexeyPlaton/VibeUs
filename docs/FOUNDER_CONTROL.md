# VibeUs Founder Control Plane

Founder administration is **not served by the public VibeUs customer runtime**.

The public deployment intentionally has no Founder routes in its React router and does not mount the Founder FastAPI routers. The production Nginx edge also returns `404` for both `/control*` and `/api/control*` as defense in depth.

The Founder Cockpit is deployed separately on a private/internal origin from the private operator repository. It reuses the same reviewed VibeUs domain models and PostgreSQL data so billing, entitlements, users and audit events do not fork into a second business model.

## Security boundary

The private control deployment is expected to have all of these layers:

1. private/loopback/Tailscale/WireGuard/identity-aware network reachability;
2. a private reverse proxy that exposes only the minimum auth and `/api/control/*` surface;
3. an internal gateway hop secret injected by that proxy and never exposed to browser JavaScript;
4. normal VibeUs authentication;
5. an explicit `PLATFORM_ADMIN_EMAILS` allow-list — workspace `owner`/`admin` never grants platform administration;
6. short-lived password step-up for sensitive Founder mutations;
7. append-only `admin.*` audit events for sensitive changes.

The private process remains fail-closed unless `ENABLE_CONTROL_CENTER=true` and at least one explicit platform-admin email is configured. Wildcards are not an authorization mechanism.

The console never returns project API tokens, runtime ingest keys, provider API secrets, token pepper or field-encryption material. Public widget keys may be displayed because they are intentionally browser-visible capabilities.

## Product Radar / Launch Cockpit

The private cockpit keeps the launch North Star and steering model:

- Weekly Value Workspaces rather than raw logins;
- Reach, Activate, First value, Return, Deliver, Monetize, Cash & trust and Learn;
- confidence/sample size so tiny cohorts are marked `insufficient` instead of producing false red/green conclusions;
- a bounded Steering Queue that protects money/trust first, then repairs the core value loop before scaling acquisition;
- explicit data-coverage gaps instead of invented metrics.

Customer runtime errors are not treated as VibeUs platform failures. Merchant/provider approval, supported geography, recurring-payment availability and fiscal contract readiness remain manual launch gates until verified against the actual provider contract.

## Private Founder surfaces

The private control plane contains the Founder-only operating surfaces built around those same domain models:

- Product Radar / launch cockpit;
- Founder Growth Strategy and its live AI-readable Markdown handoff;
- Customer 360 and support notes/tags;
- cross-project Error Center;
- billing ledger inspection and local reconciliation;
- Promo Center;
- project inspection and credential revocation without secret disclosure;
- privacy request case management;
- cohorts/funnel views;
- feature flags and announcements;
- read-only customer diagnostic view;
- audit/security and operations.

Provider-side refund/cancellation remains intentionally unavailable until the approved production payment adapter has verified remote refund/subscription/fiscal semantics. Platform-admin passkey/MFA remains a real security dependency rather than a decorative toggle.

## Test-only assembly

Founder router regression tests remain in this repository while the private control plane is being split out. During `ENVIRONMENT=test` / `TESTING=true`, pytest mounts the Founder routers into the test application only. This preserves coverage without reopening the public production surface.

Source availability is not treated as a security boundary: some generic Founder implementation already exists in public Git history. Security comes from the separate runtime/network boundary and authorization layers. Private strategy content, Founder notes and live operating data are not seeded into the public product.
