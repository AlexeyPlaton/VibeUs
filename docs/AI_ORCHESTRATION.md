# VibeUs AI Orchestration

VibeUs treats AI as an interchangeable execution surface, not as the source of truth.

The delivery path is intentionally explicit:

1. **Task** — choose a concrete VibeUs ticket with its Definition of Done and runtime/bug context.
2. **AI handoff** — use a browser AI, Google Jules, a GitHub label-driven agent or another compatible executor.
3. **Pull request** — validated Web-AI patches are bound to the exact handoff SHA and written only to a dedicated `vibeus/*` branch; cloud-agent PRs can be linked or matched back to the task.
4. **CI** — VibeUs observes the exact current PR head and applies the bounded repair policy.
5. **Preview / Review** — after live CI is green, VibeUs may request a safe non-production preview and can move the ticket to Review only when the existing VibeUs evidence contract is also ready.

The authenticated project board exposes **Work with AI / Работать с ИИ** from the current ticket. It opens `/app/ai/:projectSlug?ticket=<ticket-key>` so the same task stays selected through the delivery flow; there is no second automation engine hidden inside the ticket modal.

## Trust boundary

AI orchestration does **not** weaken the existing VibeUs acceptance model.

- AI patches never push directly to the default branch.
- VibeUs creates a dedicated `vibeus/*` branch and pull request.
- A Web-AI patch is bound to the exact `base_sha` emitted by the handoff.
- A stale base fails closed. Generate a fresh handoff instead of forcing the patch.
- Web-AI patch application rejects secret/release-sensitive paths such as `.env*`, `.github/workflows/`, production deployment files and Alembic migrations.
- Binary patches and non-UTF-8 patch targets are rejected.
- CI success is an orchestration signal. It is **not** converted into a fake trusted criteria receipt.
- Safe preview requests cannot deploy or promote production.
- Final `Review -> Accept -> done` remains a human action.
- There is intentionally no orchestration auto-merge endpoint.

## VIBEUS-PATCH v1

A web AI that has read-only GitHub access should return:

```text
VIBEUS-PATCH v1
ticket: VB-142
repository: owner/repo
base_sha: 0123456789012345678901234567890123456789
---PATCH---
diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,1 +1,1 @@
-old
+new
---END PATCH---
```

The ticket, repository and base commit are validated before any branch is created.

## Automation modes

### Manual

VibeUs prepares the context, but the user explicitly chooses every dispatch and PR action.

### Assisted

Recommended default. VibeUs prepares the handoff, creates/synchronizes the Issue when configured, validates imported patches and observes PR/CI state.

### Autopilot PR

For a configured GitHub/cloud agent, VibeUs may dispatch the Issue automatically. The agent may create its own PR, or the user can return a `VIBEUS-PATCH v1` from another model. Human acceptance remains required.

### Delivery automation

Adds CI and preview observation/request flow. Production delivery is not made implicit by this mode; merge policy remains `human_accept` or `manual`.

## CI repair budget

VibeUs counts distinct failed PR heads against `max_repair_attempts` (0–5).

For agents with a native repair loop, such as an enabled Jules workflow, VibeUs monitors the repair window instead of fabricating unsupported provider commands. For ordinary web AI, a failed PR becomes a repair-handoff state rather than an uncontrolled retry loop.

This keeps costs and behavior bounded.

## GitHub App credential

GitHub App is the preferred repository credential. Legacy PATs remain only as a migration fallback for existing projects.

Configure the VibeUs server with:

```text
GITHUB_APP_ID=<numeric app id>
GITHUB_APP_SLUG=<github app slug>
GITHUB_APP_PRIVATE_KEY_B64=<base64 encoded RSA PEM private key>
# Optional: otherwise TOKEN_PEPPER is used for HMAC state signing.
GITHUB_APP_STATE_SECRET=<at least 32 random characters/bytes>
# Optional: otherwise derived from PUBLIC_BASE_URL.
GITHUB_APP_SETUP_URL=https://your-vibeus-host/app/integrations/github/callback
```

The private key and state-signing secret are server secrets and must never be exposed to browser code or committed to the repository.

### GitHub App onboarding

The account-side onboarding flow is designed so the browser never becomes the authority for repository binding:

1. The user enters an exact `owner/repo` on **Delivery integrations**.
2. `POST /api/projects/{slug}/github/app/install-intent` creates a short-lived signed state bound to:
   - authenticated user ID;
   - VibeUs project ID;
   - exact `owner/repo`;
   - issue/expiry timestamps;
   - a nonce.
3. The browser opens the GitHub App installation URL with that signed `state`.
4. GitHub returns to the App Setup URL, normally:
   `PUBLIC_BASE_URL/app/integrations/github/callback`.
5. The callback sends only the signed state to `POST /api/github/app/install/complete`.
6. VibeUs verifies the state, confirms the same authenticated user still has `integration:manage` access to the bound project, then asks GitHub server-to-server which App installation can access the bound repository and tests repository identity with an App installation token.

VibeUs intentionally does **not** accept `installation_id` as a trusted browser binding. A query parameter or hidden field with that value cannot switch the project to another installation/repository.

For each configured `owner/repo`, VibeUs signs a short-lived RS256 App JWT, exchanges it for a repository-scoped installation token, caches that token only in process memory until shortly before expiry, and prefers it over a saved PAT.

Once App access is verified, the Delivery integrations page can remove the legacy encrypted PAT. Existing GitHub Issue sync and orchestration calls use the same App-first credential resolution.

## Safe preview delivery

The preview endpoint is deliberately **preview-only**:

`POST /api/projects/{slug}/tickets/{ticket_id}/automation/preview/deploy`

Before it can call a provider, VibeUs revalidates live state rather than trusting the UI or stale orchestration data:

- the ticket belongs to the project;
- a pull request is linked;
- the pull request is currently open and unmerged;
- both PR base and head belong to the exact connected repository;
- the live PR head SHA and branch still match the last reconciled VibeUs state;
- the PR head branch is not the base branch and is not the repository default branch;
- live GitHub Checks/combined status are green for that exact head SHA;
- the configured preview provider is enabled.

If an exact-head safe preview already exists, VibeUs returns it instead of creating a duplicate.

There is no preview `production`, `promote`, `release`, or equivalent production-delivery endpoint.

### GitHub Deployments

VibeUs creates a Deployment request for the exact PR head SHA with:

- environment `vibeus-preview/pr-<number>`;
- `transient_environment=true`;
- `production_environment=false`;
- `auto_merge=false`.

The customer repository/workflow remains responsible for actually building that preview environment. During observation VibeUs accepts only a successful Deployment that is explicitly non-production and transient/preview-like. A successful production Deployment is never used as the Review URL.

### Vercel

Vercel preview delivery requires a Vercel project ID and encrypted provider API token.

Before creating a deployment, VibeUs reads the Vercel project metadata and verifies:

- the Vercel project is linked to GitHub;
- Vercel's linked numeric repository ID equals the exact connected GitHub repository ID;
- the Vercel production branch is known;
- the PR branch is not that production branch.

VibeUs then creates a Git-backed deployment bound to the exact PR branch + SHA + repository ID. The create request intentionally omits `target`, so it requests a Preview rather than Production. If the provider response unexpectedly identifies a non-preview target, VibeUs attempts to cancel it and fails closed instead of accepting the deployment.

Observation still requires a `READY` non-production Vercel deployment whose Git SHA matches the exact PR head.

### Render

Git-backed Render PR previews do not need a Render API secret in VibeUs.

VibeUs uses the repository pull request as the authority and adds the `render-preview` label. That is the explicit request to create the Pull Request Preview in a Render project configured for manual PR previews. VibeUs does **not** call the Render base-service deploy endpoint.

When Render publishes the PR preview as a GitHub Deployment, VibeUs applies the same exact-head non-production Deployment checks before exposing its URL for Review.

### Audit trail

Every accepted safe-preview request records an `automation.preview_requested` audit event and stores non-secret request metadata in the ticket automation state: provider, mechanism, request ID, exact head SHA, PR number and the invariant `production_deploy_allowed=false`.

## GitHub webhook

The AI Orchestration page can generate a project-specific webhook secret.

Configure the shown callback in the connected repository and use the returned secret as GitHub's webhook secret. Supported event families are:

- Pull requests
- Check runs / check suites
- Deployment status

The endpoint validates `X-Hub-Signature-256` with constant-time HMAC comparison and also checks that the webhook repository matches the VibeUs project.

The secret is encrypted at rest and is only returned in plaintext when created/rotated.

## Provider capabilities

Providers are selected by capability, not embedded into ticket business logic.

Current AI presets:

- `web_ai` — copy/paste handoff; works with any browser AI that can inspect the repository or accept code/context.
- `jules` — GitHub Issue label dispatch preset (`jules`) plus native repair monitoring.
- `github_label_agent` — any agent triggered by a repository label.
- `external_agent` — an external orchestrator consuming the same task/PR contract.

Current preview providers:

- `github` — transient non-production GitHub Deployment request + exact-head observation.
- `vercel` — exact repository/branch/SHA Git-backed Preview request + exact-head observation.
- `render` — PR label request (`render-preview`) + GitHub Deployment observation.
- `disabled` — no preview request or discovery.

Future adapters can add provider-specific execution without changing `VIBEUS-PATCH`, PR validation, preview safety invariants or human acceptance.
