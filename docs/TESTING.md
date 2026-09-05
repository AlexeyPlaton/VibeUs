# Testing VibeUs

VibeUs has several test layers, but day-to-day development does not require running every check after every edit.

## Fast local checks

### Backend

```bash
cd openspec-core
python -m pytest -q
```

### Frontend and widget

```bash
cd openspec-web
npm ci
npm test
npm run build:all
```

### CLI

```bash
cd openspec-cli
npm ci
npm test
```

Run the focused suite first when changing one subsystem.

## Full release checks

From the repository root:

```bash
python run_release_gate.py
```

The release runner combines the checks that protect the current public contract:

- backend behavior and authorization;
- database migrations;
- billing/entitlement invariants;
- task verification and human-acceptance boundaries;
- frontend contract tests and TypeScript;
- case-sensitive imports and production builds;
- widget build handoff;
- CLI behavior;
- English/Russian internationalization checks.

The `quality-gates/` directory contains regression suites that were added as specific release risks were discovered. Their directory names are historical implementation details; contributors normally use the commands above rather than choosing a gate by version number.

## Browser E2E

The GitHub release workflow also starts a real FastAPI server and Vite app and runs Playwright journeys through registration/project creation and the main delivery workflow.

Browser E2E is valuable for changes that cross frontend/backend boundaries, especially authentication, onboarding, project creation, AI delivery and integrations.

## What a regression test should prove

Prefer a test that observes behavior over a test that only matches source text.

Source-contract tests are still useful for a small number of packaging, route-registration and fail-closed configuration invariants, but they should not replace runtime tests when the behavior can be exercised directly.

## Before a public release

In addition to automated checks, perform a clean black-box smoke test from an incognito browser and a clean/self-host checkout. CI passing is necessary, but it does not prove that external provider credentials, DNS, TLS, email delivery or payment-provider approval are correct in a live deployment.
