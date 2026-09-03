# Public source policy

The private canonical development repository and the public open-source repository serve different purposes.

## Private canonical repository

May contain release-forensics material used to prove historical fixes, local review exports, operator-only workflow notes, and archived pre-release documentation.

## Public repository

Must contain the reproducible product source, self-hosting documentation, current release tests/gates, contribution/security documentation, and no private development history.

The public repository is built from an exact clean canonical commit using `scripts/public_repo/build_public_mirror.py`. It is intentionally **history-free** on first publication.

### Excluded from the public mirror

- `docs/archive/` and launch-copy archaeology;
- local QA/review snapshots and release-candidate patch artifacts;
- private review-export tooling;
- obsolete forensic gate generations before the current public release contract;
- operator-only server update scripts;
- any secret-bearing local configuration or generated database/log files.

### Kept public

- `openspec-core/`, `openspec-web/`, `openspec-cli/` source;
- current migrations;
- self-hosting/API/widget documentation;
- current production-safe deployment examples;
- active release gates used by `run_release_gate.py`;
- `SECURITY.md` and `CONTRIBUTING.md`.

## Legal/operator data

The hosted `vibeus.pro` product currently includes Russian operator/legal text in the web source. Publishing the source therefore also publishes the operator details already displayed by the hosted Legal Center.

If the repository owner does **not** want hosted-operator identity/tax details duplicated on GitHub, legal copy must first be refactored into a hosted deployment layer. Do not silently redact those files in a public mirror while claiming the mirror is an exact build of the hosted product.

## License

Before the first public push, the repository owner must make the component license map explicit. Avoid ambiguous wording such as “AGPLv3/MIT” without stating which paths are covered by which license.
