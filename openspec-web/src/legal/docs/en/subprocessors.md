# VibeUs International Subprocessors & Service Providers

**Version:** 2026-09-03-international-1.0  
**Last updated:** 3 September 2026

This page identifies production service providers that may receive personal information for operation of the canonical hosted VibeUs service. A candidate integration is not listed as an active data recipient until it actually receives production data.

| Provider / category | Role / function | Data involved | Processing location | Transfer note |
|---|---|---|---|---|
| Russian hosting infrastructure provider | Compute, database and backup infrastructure | Accounts, workspaces, projects, feedback and operational data stored by VibeUs | Russian Federation, Moscow | Canonical primary hosted data perimeter; no cross-border transfer for this provider path |
| YooKassa / YooMoney group payment service | Russian domestic payment processing | Payer email, transaction amount, payment identifiers and payment status as required | Russian Federation | Domestic Russian checkout; provider may act under its own statutory/payment role |
| Local transactional email gateway | Delivery of account/service messages | Recipient email and necessary transactional message content | Russian Federation | No intended cross-border transfer in the canonical configuration |

## International payment provider

**LAVA.TOP is currently a candidate provider, not an active production processor/subprocessor for VibeUs international checkout.** International checkout remains disabled while VibeUs awaits provider confirmation of the hosted SaaS use case and completes the production webhook/payment activation review.

If LAVA (or another international provider) is activated, this page must be updated **before or at activation** with the provider's correct legal entity, role (processor/subprocessor or independent controller, as applicable), data categories, countries/locations, transfer basis where relevant, and privacy terms.

Do not interpret the existence of integration code or environment variables as evidence that a provider currently receives production personal data.

## Customer-selected integrations

GitHub, AI/model providers, messaging tools and other integrations enabled by a Customer may receive Customer Content only when the Customer configures/uses the relevant integration. Their role and transfer implications depend on that configuration and provider terms. Customers must review the intended data flow before enabling an integration.

## Changes

For a new subprocessor that materially processes Customer Personal Data on VibeUs's behalf, VibeUs aims to publish notice at least 10 calendar days before production access where reasonably practicable. Urgent security/legal/provider changes may require shorter notice; affected Customers will be informed where required.

Questions: `privacy@vibeus.pro`.
