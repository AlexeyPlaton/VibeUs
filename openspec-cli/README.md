# VibeUs CLI — Local AI Bridge

The VibeUs CLI connects your local AI development environment (Cursor, Claude Code, Windsurf, Antigravity) with VibeUs Cloud, bridging client/visual feedback with local coding agents and engineering contracts.

## Installation & Commands

Run directly with `npx` (no permanent install needed):

```bash
# Listen for tasks and sync .vibus/TASKS_FOR_AI.md
npx vibus listen --project <slug>

# Share localhost port securely via Live Preview
npx vibus share --port 3000 --project <slug>

# Run Model Context Protocol (MCP) server for Cursor / Claude Code
npx vibus mcp --project <slug>
```

Or install globally:

```bash
npm install -g vibus
vibus listen --project <slug>
```

## Options

- `--project <slug>` — Your VibeUs project slug
- `--server <url>` — Server URL (default: `https://vibeus.pro`)
- `--token <token>` — API token for authentication

The CLI automatically saves your settings to a local `.vibusrc.json` file in your workspace. Subsequent runs can omit flags when configuration is present.

## How It Works

1. **Connects** to VibeUs Cloud via WebSocket for real-time task synchronization.
2. **Fetches** the project board state via REST API.
3. **Writes** `.vibus/board.json` (raw board data) and `.vibus/TASKS_FOR_AI.md` (formatted, actionable tasks with Definition of Done contracts).
4. **Watches** for changes made to `.vibus/TASKS_FOR_AI.md` by local developers or AI agents.
5. **Claims vs Evidence**:
   - Checking a Definition of Done checkbox (`[x]`) is treated as an **implementation claim**, not proof.
   - In **Strict** and **Critical** review modes, high-severity and blocker criteria require verified machine receipts (via allowlisted local test adapters like `pytest`, `node_test`, `npm_script`, or `file_exists`) or authenticated human review before automatic advancement to Review status.
6. **Human Acceptance**:
   - AI coding agents can implement changes and satisfy machine verifiers, but final acceptance remains a **human reviewer action**.
7. **Pushes** verified progress and evidence back to VibeUs Cloud in real time.

## Integration with AI IDEs

Direct your AI coding assistant (Cursor, Claude Code, Windsurf, Antigravity) to `.vibus/TASKS_FOR_AI.md`. The agent reads tasks, context (element selector, viewport, route, sanitized stack trace), and the DoD contract, implements the fix, and runs verification commands to provide binding evidence.

## Troubleshooting

- Ensure your API token is valid and has `ticket:write` permissions.
- Verify your network connection to the server URL (`https://vibeus.pro`).
- Ensure allowlisted verifiers match target test files within your repository root.
