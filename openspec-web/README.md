# VibeUs Web & Embeddable Widget

This package contains the VibeUs React web application and the standalone embeddable feedback widget.

## Requirements

- Node.js 20+
- npm

## Development

```bash
npm ci
npm run dev
```

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build:all
```

`npm run build:all` builds both the web application and the standalone widget. The widget build is synchronized into `openspec-core/static/` by the verified build script.

## Internationalization

English is the canonical/default/fallback shipping locale. Russian is a fully supported locale with exact key parity. Partial Chinese and Hindi dictionaries are retained for future work but are not exposed in the runtime language switcher until complete and human-reviewed.

Do not hardcode user-facing copy in TS/TSX. Add semantic keys to both `src/i18n/locales/en.json` and `src/i18n/locales/ru.json`.

## Security boundaries

- The browser widget uses a public widget key. It must never embed secret API or runtime-ingest credentials.
- Customer widget origins are allowlisted per project.
- Live Preview is intentionally separated from the authenticated account application by a different registrable-domain boundary in production.
- Browser diagnostics follow a minimum-necessary model; request/response bodies and secrets are not collected by default.
- AI/automation may satisfy verification criteria, but final acceptance remains a human action.

See the repository root README, `docs/widget_integration.md`, and `docs/self_hosting.md` for product-level documentation.
