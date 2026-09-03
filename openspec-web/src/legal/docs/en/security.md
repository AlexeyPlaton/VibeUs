# VibeUs International Security Policy

**Version:** 2026-09-03-international-1.0

## Security principles

The hosted VibeUs service is designed around the following public security principles:

- tenant isolation is enforced by server-side authorisation rather than UI visibility;
- secret tokens are stored as digests where the product does not need to recover the original value;
- integration secrets that must be recoverable are encrypted at rest with environment-managed key material;
- account browser sessions use HttpOnly cookies;
- Live Preview uses an origin separated from the primary SaaS account origin in production;
- capability/access links are limited by role, scope and expiry where applicable;
- diagnostic collection follows a minimum-necessary approach and should not include secrets or raw request/response bodies by default;
- paid entitlement changes require verified server-side payment evidence rather than browser redirects;
- critical changes pass automated security, billing-integrity, migration, frontend/backend, and release checks before merge; and
- human acceptance remains distinct from an AI/agent implementation claim.

These controls reduce risk but do not make any internet service immune from compromise. Customers remain responsible for endpoint security, least-privilege access, backups, code review, and safe configuration appropriate to their own environment.

## Customer security responsibilities

Customers should:

- keep passwords, API tokens and Runtime Ingest Keys private;
- rotate a secret promptly after suspected compromise;
- restrict Public Widget origins as intended by the product;
- use test credentials rather than production secrets in Live Preview;
- review what data a configured GitHub/AI/other integration will receive; and
- test AI-generated code before production deployment.

## Vulnerability disclosure

Send vulnerability reports to `security@vibeus.pro`.

A useful report includes the affected URL/version, reproduction steps, security impact, and a safe proof of concept where appropriate.

Please do not:

- access, modify or delete data belonging to other customers;
- perform destructive testing or denial-of-service testing;
- use social engineering against users or staff;
- publish exploit details before VibeUs has acknowledged the report and had a reasonable opportunity to investigate and remediate; or
- demand payment or threaten disclosure as a condition for withholding harmful exploitation.

We will make a reasonable effort to acknowledge good-faith reports and coordinate remediation/disclosure. This policy is not a promise of a bug-bounty payment unless a separate bounty programme expressly states otherwise.

## Security incidents

Confirmed personal-data incidents are handled under the applicable Privacy Notice and DPA. Other security incidents are investigated, contained, remediated and documented according to the service incident-response process.

Security: `security@vibeus.pro`  
Abuse: `abuse@vibeus.pro`
