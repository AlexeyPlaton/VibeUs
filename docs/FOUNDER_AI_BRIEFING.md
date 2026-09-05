# VibeUs Founder AI Brief & Launch Workbench

The founder operating area is split into three views:

- `/control` — Product Radar / Launch Cockpit;
- `/control/workbench` — launch distribution, live AI briefing and founder growth/support controls;
- `/control/ops` — operational customer/billing/project/security console.

All three remain platform-admin only. Founder mutations use the same short-lived password step-up as other sensitive Control Center actions.

## Live Markdown instead of a stale committed metrics file

A committed Markdown snapshot would become false as soon as the next signup, feedback item, payment or runtime error arrives. VibeUs therefore exposes a **live Markdown representation** generated from the same server-side data as Product Radar:

- `GET /api/control/briefing.md`
- alias: `GET /api/control/radar.md`
- structured twin: `GET /api/control/briefing.json`

The response is platform-admin authenticated and carries `Cache-Control: no-store` plus `X-Robots-Tag: noindex, nofollow`.

The Markdown contains:

- current North Star and previous-period comparison;
- every radar dimension, score, value, target, confidence, sample and trend;
- Steering Queue;
- current 7-day value loop;
- launch guardrails;
- instrumentation/data-confidence gaps;
- launch-publication checklist progress;
- local payment/entitlement/fiscal reconciliation;
- status of founder-control capabilities;
- a recommended output contract for an AI strategist.

It intentionally excludes customer free-form feedback/support content, customer emails, workspace names and secrets. The purpose is to make the brief suitable for pasting into ChatGPT or another AI without turning a strategy review into a raw customer-data export.

### Suggested AI request

After copying the live brief, ask the AI to:

> Diagnose the current VibeUs trajectory. Pick the single highest-leverage steering decision, explain the evidence and confidence, tell me what not to optimize yet, propose one primary experiment and one fallback experiment with success thresholds, and identify any missing data that makes the recommendation premature.

The AI brief itself also contains these interpretation guardrails so another model is less likely to optimize vanity metrics or treat a tiny cohort as statistically meaningful.

## Launch distribution checklist

`/control/workbench` contains a persistent private launch runbook. Progress is stored append-only in the existing founder audit ledger, so the checklist survives deploys without introducing a second source of truth for admin history.

Each publication item has:

- channel/group and intended market;
- why to use it;
- recommended post format/angle;
- preflight checks;
- success signal tied back to product value rather than impressions;
- current state: `todo`, `preparing`, `published`, or `skipped`;
- actual publication URL;
- private founder note;
- first publication timestamp.

Initial surfaces include owned launch copy, GitHub Release/README discovery, Product Hunt, Show HN, Indie Hackers, relevant Reddit communities, DEV/technical content, LinkedIn/X, Habr, vc.ru, Telegram communities, direct beta outreach, partnerships and later directory/review discovery.

Third-party community rules are deliberately not treated as immutable product constants. The runbook tells the founder to re-check current submission/self-promotion/commercial-placement rules before each publication.

## Former Post-MVP controls

The workbench converts the safe first-party roadmap placeholders into real control surfaces:

### Customer 360

A read-only cross-workspace timeline combines account creation, workspaces, projects, captured feedback metadata, runtime-error groups, payment ledger events and non-secret audit events.

### Internal support notes and tags

Founder notes/tags are append-only admin events and require step-up. They should never contain credentials or unnecessary sensitive data.

### Cross-project Error Center

Recent error groups from all non-deleted projects are visible in one read-only triage surface. It does not change customer error state and cannot turn a linked task into human acceptance.

### Payment reconciliation

The workbench checks local invariants such as stale pending payments, fiscal follow-up, paid entitlement without visible payment/promo provenance, and entitlement-period drift.

This is explicitly **local reconciliation**. It never claims to know provider truth unless a verified live provider adapter/webhook/reconciliation API supplies it.

### Privacy request case management

Founder controls can create and track export/delete/anonymize/rectify cases and inspect a data manifest preview. Destructive deletion/anonymisation is intentionally not automated yet because retention/legal obligations and a verified executor must be designed first.

### Cohorts and funnel

The founder view groups signup cohorts by week and measures owner activation within 24 hours plus real paid conversion. Landing visits remain an explicit missing denominator until first-party acquisition telemetry is implemented.

### Feature flags

Flags have a founder registry plus a real authenticated runtime evaluator at `GET /api/feature-flags`.

Evaluation supports:

- enabled/disabled state;
- deterministic percentage rollout;
- optional workspace allow-list;
- optional expiry.

The runtime endpoint returns only evaluated booleans, not founder-only flag descriptions/configuration.

### Announcements

Founder announcements have a registry and an authenticated runtime endpoint at `GET /api/announcements`, with optional workspace and tier targeting.

### Read-only customer diagnostic

The old “View as customer” idea is implemented as a safer diagnostic snapshot. It never mints a customer bearer, cookie or impersonation session. The founder can inspect the sanitized customer-visible state without silently becoming the customer.

### Founder shortcuts

The workbench keeps direct links to Radar, Operations, the live Markdown brief, the normal account and the repository.

## Capabilities intentionally still blocked

Two roadmap items remain explicit dependencies rather than fake implementation:

1. **Platform-admin passkey/MFA** — must be a real WebAuthn/passkey credential lifecycle including enrollment, verification, recovery, revocation and audit semantics.
2. **Provider-side refund / recurring cancellation** — must wait for the actually approved production payment provider and verified remote refund/subscription/fiscal semantics. A local status mutation is not a refund.

This distinction is visible in `/control/workbench` so “implemented” always means a real path exists.

## Product direction this enables

The combination of Product Radar + live AI brief + intervention history is a useful product pattern beyond VibeUs itself: a founder/marketing operating assistant could ingest first-party product, revenue, support and distribution signals, expose confidence-aware radar state, and let an AI recommend the next bounded experiment instead of producing generic marketing advice.

The important differentiator would not be “AI writes marketing posts”. It would be **closed-loop steering**:

`signal → diagnosis → hypothesis → action → distribution → measured product effect → next decision`.

VibeUs now contains a small internal version of that loop for its own launch, which means future product exploration can start from real operating experience rather than a speculative dashboard mockup.
