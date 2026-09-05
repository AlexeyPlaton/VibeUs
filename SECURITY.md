# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a suspected vulnerability that could expose credentials, personal data, tenant data, billing state, authentication/authorization boundaries, or Live Preview isolation.

Send private security reports to the confirmed support mailbox **support@vibeus.pro** with the subject prefix **`[SECURITY]`**. If the specialist alias `security@vibeus.pro` is configured for the deployment, it may also be used.

Include:

- affected component and version/commit, if known;
- reproduction steps;
- expected vs actual security boundary;
- impact;
- a minimal proof of concept that does not access data you are not authorized to access.

Do not include real customer secrets or personal data in the report unless absolutely necessary. Redact credentials and rotate any credential that may already have been exposed.

## Scope notes

VibeUs has several explicit trust boundaries that are especially relevant to security reports:

- public widget credentials vs secret API/runtime-ingest credentials;
- tenant/workspace authorization;
- browser-session CSRF protections;
- Live Preview isolation from the account origin;
- runtime diagnostic data minimization/redaction;
- billing ledger/idempotency/refund state;
- criteria evidence provenance and Review authorization.

## Supported code

Security fixes are evaluated against the current `main` release contract and the official release gate. Historical archived material is not a supported deployment target.
