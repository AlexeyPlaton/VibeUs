# Billing

VibeUs separates product entitlements from payment-provider redirects and browser state.

## Hosted VibeUs

Hosted paid-plan availability depends on the deployment's approved payment-provider configuration and legal/fiscal scope.

A provider adapter existing in source code does **not** mean that a VibeUs merchant account is approved for every country, card type, currency or recurring-payment scenario. Production provider flags should remain disabled until the actual merchant account and fiscal flow have been verified.

## Settlement rule

A browser success/return URL is not authoritative payment proof.

Paid access is granted only after a server-side provider event or reconciliation path has been validated against the expected payment/workspace, amount and currency and processed idempotently.

## Self-hosting

Self-hosted operators are responsible for:

- choosing a provider they are permitted to use;
- configuring its credentials only on the server;
- validating webhook authenticity and idempotency;
- checking tax/fiscal/receipt obligations for their own business and customers;
- testing refunds and delayed/duplicate provider events before enabling paid production access.

The repository contains optional provider adapters for development and integration work. Do not enable one simply because the code is present.

## Local development

For a normal local product smoke test, keep live billing providers disabled. Mock billing may be used only in development/test environments where the configuration explicitly allows it.

## Operator runbooks

Merchant-specific onboarding, contracts, fiscal instructions, personal/business requisites and founder revenue operations are intentionally not public product documentation. Keep those in the private operator environment.
