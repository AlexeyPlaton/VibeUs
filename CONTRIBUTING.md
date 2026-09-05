# Contributing to VibeUs

Thanks for helping improve VibeUs.

## Before opening a pull request

1. Start from the current `main` branch.
2. Keep the change focused on one problem.
3. Do not commit `.env` files, credentials, database exports, customer data, production logs with sensitive data, or local machine paths.
4. Add a regression test for bug fixes whenever the behavior is automatable.
5. Preserve tenant, authentication, payment and preview-isolation boundaries instead of weakening them to make a test pass.
6. Run the focused tests for the area you changed. Run the full release checks before a release-sized change when your environment supports it.

## Main verification commands

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

Backend:

```bash
cd openspec-core
python -m pytest -q
```

Full repository release checks:

```bash
python run_release_gate.py
```

See `docs/TESTING.md` for the purpose of each layer.

## Pull request expectations

A useful pull request explains:

- the problem being solved;
- the user-visible or system behavior that changes;
- how it was tested;
- any migration, deployment or compatibility impact.

Screenshots or a short recording are useful for visible UI changes.

## AI-assisted development

AI-assisted coding is welcome. The contributor remains responsible for the change.

Generated or heavily assisted code should meet the same bar as handwritten code: understandable diff, correct behavior, tests where appropriate, no invented APIs or configuration, and no weakening of security boundaries. Do not include model transcripts, prompt dumps or private customer context in the repository.

## Product rules worth preserving

- Final acceptance of a task remains a human action.
- A checked Definition of Done item is not automatically proof of completion.
- Public widget credentials and secret developer/runtime credentials are separate capabilities.
- Do not execute shell commands derived from untrusted ticket or feedback text.
- Keep browser diagnostics to the minimum context needed for the task.
- UI language and billing-market configuration are separate concerns.

## Security reports

Do not publish exploitable vulnerabilities as normal issues. See `SECURITY.md`.

## Style

Prefer clear names, small modules and behavior-oriented tests over additional framework layers. If a simpler implementation preserves the same contract, prefer the simpler one.
