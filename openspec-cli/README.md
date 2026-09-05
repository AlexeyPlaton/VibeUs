# VibeUs CLI

The VibeUs CLI keeps project feedback and tasks close to the code.

Use it to:

- sync the project board into `.vibus/TASKS_FOR_AI.md`;
- run the VibeUs MCP server for local developer/agent workflows;
- expose a local development server through Live Preview.

## Quick start

Run without a global install:

```bash
npx vibus listen --project <slug> --server https://vibeus.pro
```

Or install globally:

```bash
npm install -g vibus
vibus listen --project <slug>
```

## Commands

### Listen and sync tasks

```bash
npx vibus listen --project <slug>
```

The CLI writes:

```text
.vibus/
├── board.json
└── TASKS_FOR_AI.md
```

`TASKS_FOR_AI.md` is plain Markdown so developers and local coding tools can read the same task context.

### MCP

```bash
npx vibus mcp --project <slug>
```

### Live Preview

```bash
npx vibus share --port 3000 --project <slug>
```

## Common options

- `--project <slug>` — VibeUs project slug;
- `--server <url>` — VibeUs server, default `https://vibeus.pro`;
- `--token <token>` — developer API token when required.

Workspace settings are saved locally in `.vibusrc.json` so later commands can omit repeated flags.

## Task verification

A checked Definition of Done item is treated as an implementation claim. Depending on the task policy, higher-risk criteria can require verified local evidence before the task advances to Review. Final acceptance remains a human action.

## Troubleshooting

- Check that the project slug and server URL are correct.
- Check that the API token has the required project capability.
- If a verifier is used, make sure its target stays inside the repository root and matches an allowed verifier type.
