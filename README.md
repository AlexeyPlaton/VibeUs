# VibeUs

**Turn vague feedback into an engineering task a developer or coding agent can actually use.**

A reviewer clicks the broken part of the page. VibeUs keeps the route, viewport, selected element and useful diagnostic context attached to the report, then makes the task available in the web board, Markdown next to the repository, or MCP.

AI can help implement the fix. **A human accepts the result.**

[Try VibeUs](https://vibeus.pro) · [Widget setup](docs/WIDGET_INTEGRATION.md) · [Self-host](docs/SELF_HOSTING.md) · [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md)

Support: **support@vibeus.pro**

---

## What problem does it solve?

Feedback such as “the checkout button is broken on mobile” is useful to the person looking at the screen, but incomplete for the person fixing it.

Before work can start, somebody usually has to recover the page, viewport, element, reproduction steps and sometimes a related backend failure, then move all of that into an issue, IDE or coding-agent prompt.

VibeUs is the bridge between those two moments.

```text
reviewer / QA
     │
     │ clicks the real UI problem
     ▼
visual feedback + minimal context
     │
     ├── web board
     ├── .vibus/TASKS_FOR_AI.md
     └── MCP
              │
              ▼
      developer / coding agent
              │
              ▼
       verification + Review
              │
              ▼
        human acceptance
```

Backend failures can enter the same workflow through the Runtime Error Bridge.

---

## Quick start

Create a project in the hosted workspace and copy the generated widget snippet:

```html
<script
  src="https://vibeus.pro/static/vibus-widget.umd.cjs"
  data-project="your-project-slug"
  data-public-key="vb_pub_your_public_key"
  data-server="https://vibeus.pro"
  data-mode="public_feedback"
  async>
</script>
```

The browser receives only the **Public Widget Key**. Secret API and runtime-ingest credentials stay server-side or in trusted developer tooling.

### Bring tasks next to the code

```bash
npx vibus listen --project your-project-slug --server https://vibeus.pro
```

The CLI maintains:

```text
.vibus/
├── board.json
└── TASKS_FOR_AI.md
```

### Use MCP

```bash
npx vibus mcp --project your-project-slug
```

### Share localhost for review

```bash
npx vibus share --port 3000 --server https://vibeus.pro
```

Live Preview creates a temporary review path for a local development server.

---

## Included

- element-attached visual feedback;
- text and voice feedback;
- Runtime Error Bridge;
- project board and Review flow;
- `.vibus/TASKS_FOR_AI.md` projection;
- MCP integration;
- Live Preview;
- optional verification evidence for high-risk Definition of Done criteria;
- GitHub delivery integration and non-production previews;
- hosted and self-hosted deployment;
- English and Russian UI.

VibeUs is intentionally not an IDE, code generator or Jira replacement. It focuses on getting useful context from the person who sees a problem to the person or agent that fixes it.

---

## Trust and safety boundaries

A few product rules are deliberately simple:

- a checked Definition of Done item is a claim, not proof;
- high-risk criteria can require verification evidence before Review;
- final acceptance is a human action;
- public widget keys and secret developer credentials are separate capabilities;
- browser diagnostics follow a minimum-necessary model;
- production Live Preview is isolated from the account origin;
- payment redirects are not treated as authoritative settlement events.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and [Architecture](docs/ARCHITECTURE.md) for the main trust boundaries.

---

## Self-hosting

From a clean clone:

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

Open `http://localhost`. The API is available at `http://localhost:8000`; readiness is `http://localhost:8000/ready`.

The current WebSocket / Live Preview registries keep active connection state in-process, so the backend should run with **one Uvicorn worker** until distributed routing/state is implemented.

See [Self-Hosting VibeUs](docs/SELF_HOSTING.md) before a production deployment.

---

## Repository map

```text
openspec-web/   React app + embeddable widget
openspec-core/  FastAPI backend + persistence + integrations
openspec-cli/   local CLI, Markdown sync, MCP and Live Preview client
quality-gates/  release regression checks
mcp-server/     MCP-related server tooling
```

A shorter system overview is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Development

Frontend and widget:

```bash
cd openspec-web
npm ci
npm test
npm run build:all
```

CLI:

```bash
cd openspec-cli
npm ci
npm test
```

Full release checks:

```bash
python run_release_gate.py
```

The release checks cover backend behavior, migrations, frontend contracts, TypeScript, builds, CLI behavior, security-sensitive invariants and internationalization. See [docs/TESTING.md](docs/TESTING.md) for the shorter developer workflow.

---

## Billing

Hosted paid-plan availability depends on the deployment and approved payment-provider configuration. Provider flags in source code do not prove that a merchant account is approved or enabled.

Self-hosted operators are responsible for the provider, tax and fiscal configuration they enable. See [docs/BILLING.md](docs/BILLING.md).

---

## Project status

VibeUs is in early public-product validation. The priority is learning whether teams keep the feedback → engineering → human-acceptance loop in their real workflow.

If you try it, the most useful feedback is: **where did you leave the VibeUs flow and fall back to screenshots, chat, Jira or a hand-written prompt — and why?**
