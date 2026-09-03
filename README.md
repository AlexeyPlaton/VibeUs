# VibeUs

**Turn “this is broken” into an AI-ready engineering task.**

VibeUs connects visual feedback, runtime failures, developers, and coding agents without making the client learn a ticket tracker.

A reviewer points at the real UI problem. VibeUs keeps the page, element, viewport, and minimum diagnostic context attached, then sends the work to the built-in board, readable Markdown next to your repository, or MCP.

AI can do the implementation. **Final acceptance stays human.**

[Live product](https://vibeus.pro) · [Widget integration](docs/widget_integration.md) · [Self-hosting](docs/self_hosting.md) · [API](docs/api.md)

---

## The loop

```text
client / QA feedback
        ↓
page + element + viewport + context
        ↓
VibeUs ticket
        ↓
Kanban / TASKS_FOR_AI.md / MCP
        ↓
developer or coding agent
        ↓
verified Definition of Done
        ↓
human Review / acceptance
```

Backend failures can enter the same workflow through the Runtime Error Bridge using sanitized runtime context such as route, stack metadata, and request/correlation ID.

---

## Why VibeUs exists

“The checkout button is broken on mobile” is obvious to the person looking at the screen.

It is not yet a useful engineering task.

Usually somebody still has to recover the route, viewport, exact element, reproduction details, maybe a backend failure, and then copy all of that into an IDE or coding agent.

VibeUs tries to remove that translation step.

It is **not** a replacement for your IDE, Git workflow, or Jira. It starts earlier — at the moment a human sees a problem but the developer does not yet have enough context to act on it.

---

## Try the visual feedback flow

Create a project in the hosted workspace, then copy the generated widget snippet from the dashboard.

The canonical embed looks like this:

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

The browser receives only the **Public Widget Key**. Do not put secret API tokens in frontend HTML.

---

## Bring tasks next to the code

Run the CLI directly with `npx`:

```bash
npx vibus listen --project your-project-slug --server https://vibeus.pro
```

Or install it globally:

```bash
npm install -g vibus
vibus listen
```

The CLI maintains:

```text
.vibus/
├── board.json
└── TASKS_FOR_AI.md
```

`TASKS_FOR_AI.md` is designed to be readable by both developers and local coding agents.

For Strict/Critical work, checking a DoD item does **not** prove completion by itself. Required BLOCKER/HIGH criteria need a valid verification receipt bound to the current criterion contract before automatic Review can be unlocked.

---

## MCP

VibeUs also exposes structured actions for agent workflows through MCP:

```bash
npx vibus mcp --project your-project-slug
```

This lets an agent work with VibeUs tasks without making the hosted UI the center of your development workflow.

---

## Share localhost for review

```bash
npx vibus share --port 3000 --server https://vibeus.pro
```

Live Preview creates a temporary review path for a local development server.

For hosted production deployments, account/API traffic and untrusted preview traffic are intentionally separated onto different registrable domains.

---

## What is included

- Visual, element-attached feedback widget.
- Text / voice feedback flow.
- Runtime Error Bridge.
- Kanban and human Review.
- `.vibus/TASKS_FOR_AI.md` projection.
- MCP integration.
- Live Preview tunnel.
- Engineering Criteria Contract with risk-based verification.
- Contract-bound machine evidence for Strict/Critical criteria.
- Hosted workspace and self-hosted deployment.
- English and Russian shipping UI.

---

## Trust model

VibeUs deliberately does not implement “AI changed code, therefore done.”

Important boundaries include:

- `[x]` is an implementation claim, not proof.
- Strict/Critical BLOCKER/HIGH criteria require verified evidence before automatic Review.
- Evidence is bound to the exact criterion contract, adapter, target, result, and verifier provenance.
- Final acceptance remains a human action.
- Public widget keys are not treated as secrets.
- Secret API / ingest tokens are separate credentials.
- Browser diagnostics follow a minimum-necessary model.
- Live Preview is isolated from the account origin in production.

The repository includes executable release gates for security, billing, evidence binding, migrations, frontend contracts, casing, builds, CLI behavior, and i18n.

---

## Self-hosting

VibeUs can be run on your own infrastructure.

Fastest local stack:

```bash
git clone https://github.com/AlexeyPlaton/VibeUs.git vibeus
cd vibeus
cp .env.example .env
docker compose up -d --build
```

See [Self-Hosting VibeUs](docs/self_hosting.md) before a production deployment.

### Current scaling limitation

The current WebSocket / Live Preview registries keep active connection state in-process. Run the backend with **one Uvicorn worker** until distributed routing/state is implemented.

---

## International / hosted availability

The product UI ships in English and Russian.

UI language and billing market are separate. Hosted payment methods and paid-plan availability depend on region. The current Legal Center explains the active hosted legal scope; self-hosted use is governed by the applicable repository/component licenses and documentation.

---

## Development

Frontend + widget:

```bash
cd openspec-web
npm install
npm run build:all
```

CLI:

```bash
cd openspec-cli
npm install
npm test
```

Official release gate:

```bash
python run_release_gate.py
```

---

## Project status

VibeUs is at the stage where real workflow feedback matters more than adding another large feature.

If you try it, the most useful feedback is not “looks cool”.

Tell me **where you leave the VibeUs loop and fall back to screenshots, chat, Jira, or a hand-written prompt — and why.**
