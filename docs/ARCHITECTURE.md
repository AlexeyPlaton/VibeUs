# Architecture

This document gives the shortest useful map of VibeUs for contributors and self-hosted operators.

## Main components

```text
                 ┌────────────────────┐
                 │  reviewer / QA UI  │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ embeddable widget  │
                 └─────────┬──────────┘
                           │ public feedback API
                           ▼
┌──────────────┐   ┌────────────────────┐   ┌──────────────────────┐
│ Runtime SDK  │──►│   FastAPI backend  │──►│ PostgreSQL / storage │
└──────────────┘   └─────────┬──────────┘   └──────────────────────┘
                             │
                 ┌───────────┼───────────┐
                 │           │           │
                 ▼           ▼           ▼
             web board     CLI/MD       MCP
                 │           │           │
                 └───────────┴───────────┘
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

## `openspec-web`

Contains the React application and the embeddable feedback widget.

The public widget is intentionally capability-limited. A project can expose a Public Widget Key to browser code without exposing the developer API token or runtime-ingest key.

## `openspec-core`

Contains the FastAPI application, persistence layer, project/workspace authorization, billing ledger, runtime-error ingestion, task lifecycle and external delivery integrations.

The backend is the source of truth for authorization, entitlements, payment state and task transitions. Browser state is never authoritative for those boundaries.

## `openspec-cli`

Keeps project work next to a local repository. `vibus listen` writes `.vibus/TASKS_FOR_AI.md`, `vibus mcp` exposes structured task operations, and `vibus share` handles Live Preview.

## Task lifecycle

The normal delivery path is:

```text
feedback/error → task → implementation → verification → Review → human acceptance
```

VibeUs deliberately separates implementation from acceptance. A coding agent may change code and satisfy allowed verifiers, but final acceptance is still a human action.

## Important trust boundaries

### Public widget vs secret credentials

- Public Widget Keys may be embedded in browser code.
- Developer API tokens and runtime-ingest keys are separate secrets.
- Secret credentials must not be copied into widget HTML or client-side bundles.

### Browser vs backend authority

The backend owns:

- workspace/project permissions;
- entitlement and project limits;
- payment settlement state;
- task Review/acceptance rules;
- secret credential rotation/revocation.

### Verification evidence

For tasks that require stronger verification, evidence is checked against the current criterion/verifier contract. A checkbox alone is not treated as proof.

### Live Preview

Production account/API traffic and untrusted preview traffic use separate origin boundaries. Preview deployment helpers are restricted to non-production delivery paths.

### Founder/operator controls

Founder/business administration is not served by the public customer runtime. The public production edge explicitly denies `/control*` and `/api/control*`; operator tooling is deployed separately.

## Runtime scaling note

WebSocket and Live Preview connection registries currently keep active state in-process. Use one Uvicorn worker until this state is moved to a distributed coordination layer.

## More detail

- [Widget integration](WIDGET_INTEGRATION.md)
- [API](API.md)
- [Self-hosting](SELF_HOSTING.md)
- [AI-assisted delivery](AI_ORCHESTRATION.md)
- [Security policy](../SECURITY.md)
- [Testing](TESTING.md)
