# Private Founder Growth Strategy

VibeUs has a founder-only strategy workspace that deliberately separates the **public engine** from the founder's **private concrete launch plan**.

Surfaces:

- `/control/strategy` — private strategy workspace;
- `GET /api/control/growth-strategy` — current structured state;
- `POST /api/control/growth-strategy/import` — elevated private JSON import;
- `PATCH /api/control/growth-strategy/{key}/progress` — elevated execution evidence update;
- `GET /api/control/growth-strategy/export` — private backup;
- `GET /api/control/growth-strategy.md` — live AI-readable strategy + Product Radar;
- alias: `GET /api/control/strategy.md`.

All reads require `platform_admin`. Imports and progress writes also require the existing short-lived founder password step-up.

## Privacy boundary

The public repository contains **no pre-seeded concrete VibeUs marketing/publication strategy**. Strategy definitions are imported into the running founder instance and stored append-only in the existing `AuditEvent` ledger.

This matters because a public repository is not an appropriate place for a founder-only publication plan, unpublished article briefs or private execution notes.

The live Markdown does not intentionally add customer emails, customer free-form feedback/support content or credentials. However, founder-entered `planned`, `actual` and `result` fields are included verbatim. Do not paste credentials or unnecessary personal data into those fields if the Markdown may later be shared with an external AI.

## Private strategy pack schema

Import JSON uses this shape:

```json
{
  "items": [
    {
      "key": "unique_key",
      "wave": 0,
      "phase": "Foundation",
      "priority": 10,
      "kind": "publication",
      "channel": "Channel name",
      "market": "RU + EN",
      "title": "Concrete article/action placeholder",
      "goal": "Why this exists",
      "trigger": "When it should happen",
      "planned": "What should be published or done",
      "format": "Expected format",
      "preflight": ["Checks before execution"],
      "success_signal": "What useful result looks like",
      "destination": "https://optional.example/",
      "rules_note": "Channel-specific caution"
    }
  ],
  "archive_missing": false
}
```

The UI can read a JSON file locally or accept pasted JSON. Selecting a file does not save it automatically; the founder must explicitly import it after step-up.

## Planned brief vs actual completion evidence

Each strategy card shows the imported plan read-only and keeps mutable execution state separately:

- `workflow_state`: `todo`, `preparing`, or `skipped`;
- `actual`: what was actually published/completed;
- `link`: optional public/artifact URL;
- `result`: observed result, objections and learning.

`actual` is completion evidence. Any non-empty saved value derives status `done` automatically and records the first completion timestamp. Clearing `actual` reopens the item to its saved workflow state.

This makes completion harder to drift from reality: the founder does not merely tick a box, but records what was actually shipped.

## Strategy history

Definitions are append-only audit events under `admin.growth_strategy.definition_saved`.

Execution state is append-only under `admin.growth_strategy.progress_updated`.

Import operations also write an `admin.growth_strategy.imported` summary event.

No new database table is required and prior founder states remain auditable.

## Live Markdown for AI reviews

`/api/control/growth-strategy.md` is regenerated on every request from:

- current Product Radar North Star;
- every radar dimension, confidence/sample and trend;
- Steering Queue;
- the imported private strategy;
- each card's workflow state;
- founder-entered actual publication/completion evidence;
- links;
- founder-entered result/learning;
- the next unfinished saved strategy items.

The Markdown tells an AI reviewer to respect completed evidence, protect money/trust/legal/reliability before scaling acquisition, prioritize activation/repeat value over vanity metrics, and ask for a fresh third-party rules check when needed.

Responses are `no-store` and `noindex`.

## Recommended AI request

After copying the live Markdown:

> Review the current VibeUs Product Radar and saved founder strategy. Respect everything already completed by actual evidence. Tell me the next 1–3 actions in order, what I should not publish or scale yet, whether live product signals justify changing the planned order, and what metric or observation I should review after each action.
