# Contributing to VibeUs

Thanks for helping improve VibeUs.

## Dual-Repository Development Model & Pull Requests

VibeUs uses a dual-repository architecture to deliver clean, reproducible open-source releases without publishing internal development artifacts, forensic test baselines, or private deployment credentials:
- **Public Repository (`AlexeyPlaton/VibeUs`)**: The open-source face for community issues, discussions, and external Pull Requests.
- **Canonical Repository**: Private development source of truth, forensic verification history, and continuous production deployment orchestration.

### Pull Request Lifecycle
1. **Submit**: Contributors fork and open Pull Requests against `main` on the public `AlexeyPlaton/VibeUs` repository.
2. **Review**: Maintainers review the proposed code and test additions.
3. **Import & Verification**: Approved PR changes are imported into the canonical repository, where the full 16-section release gate (`python run_release_gate.py`) executes.
4. **Mirror Synchronization**: Automated mirror tooling (`build_public_mirror.py`) regenerates and synchronizes the public repository with full contributor git attribution preserved.

## Before opening a pull request

1. Start from the current `main` branch.
2. Keep changes focused on one problem.
3. Do not commit `.env` files, credentials, production exports, database files, customer data, review snapshots, or local machine paths.
4. Add a regression test for bug fixes whenever the behavior is automatable.
5. Preserve security and tenant boundaries rather than making a test pass by disabling the protected behavior.
6. Run the relevant focused tests first, then the official release gate when your environment supports it.

## Main verification commands

```bash
# Frontend / widget
cd openspec-web
npm ci
npm test
npm run build:all

# CLI
cd ../openspec-cli
npm ci
npm test

# Full release contract (from repository root)
cd ..
python run_release_gate.py
```

The release gate includes backend, migrations, frontend contracts, TypeScript, Linux case-sensitive imports, widget build, CLI, billing/security gates, criteria evidence binding, and i18n checks.

## Engineering criteria

A checked Definition of Done item (`[x]`) is an implementation claim, not proof. For Strict/Critical work, required high-risk criteria may need allowlisted verification evidence before Review. Final acceptance remains a human action.

## Security reports

Do not publish exploitable vulnerabilities as normal issues. See `SECURITY.md`.

## Style

- Prefer clear, small changes over broad rewrites.
- Keep user-facing copy in the i18n locale files.
- Keep UI language independent from billing market/payment configuration.
- Do not introduce shell execution from untrusted ticket/AI input.
- Do not weaken data-minimization defaults.
