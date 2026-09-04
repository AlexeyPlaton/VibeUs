# VibeUs AI Orchestration

VibeUs treats AI as an interchangeable execution surface, not as the source of truth.

The orchestration layer supports three useful paths without requiring an IDE:

1. **Web AI handoff** — ChatGPT, Claude, Gemini, DeepSeek, Qwen, GLM or another browser chat receives a portable task prompt. If it cannot write GitHub, it returns `VIBEUS-PATCH v1`.
2. **GitHub agent dispatch** — VibeUs creates/synchronizes a GitHub Issue and can apply a configured dispatch label. The first built-in preset is Google Jules (`jules`).
3. **PR delivery observation** — VibeUs follows the pull request, GitHub checks and deployment previews and can move a ticket to Review only when the existing VibeUs evidence contract is also satisfied.

## Trust boundary

AI orchestration does **not** weaken the existing VibeUs acceptance model.

- AI patches never push directly to the default branch.
- VibeUs creates a dedicated `vibeus/*` branch and pull request.
- A patch is bound to the exact `base_sha` emitted by the handoff.
- A stale base fails closed. Generate a fresh handoff instead of forcing the patch.
- Web-AI patch application rejects secret/release-sensitive paths such as `.env*`, `.github/workflows/`, production deployment files and Alembic migrations.
- Binary patches and non-UTF-8 patch targets are rejected.
- CI success is an orchestration signal. It is **not** converted into a fake trusted criteria receipt.
- Final `Review -> Accept -> done` remains a human action.
- There is intentionally no orchestration auto-merge endpoint in this release.

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

Adds CI/deployment observation and preview discovery. Production delivery is not made implicit by this mode; merge policy remains `human_accept` or `manual`.

## CI repair budget

VibeUs counts distinct failed PR heads against `max_repair_attempts` (0–5).

For agents with a native repair loop, such as an enabled Jules workflow, VibeUs monitors the repair window instead of fabricating unsupported provider commands. For ordinary web AI, a failed PR becomes a repair-handoff state rather than an uncontrolled retry loop.

This keeps costs and behavior bounded.

## GitHub webhook

The AI Orchestration page can generate a project-specific webhook secret.

Configure the shown callback in the connected repository and use the returned secret as GitHub's webhook secret. Supported event families in this release are:

- Pull requests
- Check runs / check suites
- Deployment status

The endpoint validates `X-Hub-Signature-256` with constant-time HMAC comparison and also checks that the webhook repository matches the VibeUs project.

The secret is encrypted at rest and is only returned in plaintext when created/rotated.

## Current GitHub credential

The current release still uses the project's encrypted GitHub PAT integration. Keep the token fine-grained and repository-scoped.

A GitHub App is the intended next credential layer because it can provide repository selection and narrowly scoped, revocable permissions without asking users to maintain PATs. The orchestration contract is deliberately separated from credential storage so that migration does not require changing the AI workflow.

## Provider capabilities

Providers are selected by capability, not embedded into ticket business logic.

Current presets:

- `web_ai` — copy/paste handoff; works with any browser AI that can inspect the repository or accept code/context.
- `jules` — GitHub Issue label dispatch preset (`jules`) plus native repair monitoring.
- `github_label_agent` — any agent triggered by a repository label.
- `external_agent` — an external orchestrator consuming the same task/PR contract.

Future adapters can add provider-specific dispatch without changing `VIBEUS-PATCH`, PR validation or human acceptance.
