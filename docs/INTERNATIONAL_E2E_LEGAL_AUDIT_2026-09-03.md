# International Hosted Launch E2E & Legal Audit — 2026-09-03

## Scope

Review of the current public VibeUs international path from the perspective of a non-Russian customer: landing -> language/pricing -> registration -> legal acceptance -> project draft -> paid checkout boundary -> payment return -> entitlement/project creation -> dashboard, plus the public legal-document surface.

This audit is a release-engineering/legal-readiness record, not a substitute for jurisdiction-specific professional advice.

## PASS — current product contracts

- English is the canonical/default UI locale; Russian is the second shipping locale.
- UI locale and billing market are separate choices.
- International pricing already comes from the backend canonical catalog rather than duplicated React constants.
- Paid project creation occurs after entitlement/payment confirmation; a browser return from the provider is not authoritative.
- An abandoned/failed checkout does not intentionally consume the free project slot; the project draft remains in the tab/session workflow.
- Current paid access is a 30-day manual-renewal model, not an undisclosed recurring subscription.
- Registration records an explicit legal-document version and requires acceptance of Terms plus acknowledgement of Privacy.
- The hosted code already separates account/browser sessions from the Live Preview origin and uses a minimum-necessary diagnostics model.

## BLOCKER found and fixed in this change

### English legal navigation previously displayed Russian legal documents

Before this change, `legalpage.tsx` used a single Russian Markdown set for every locale. Selecting English translated navigation labels but did not translate the binding Terms, Privacy Notice, DPA, Refund Policy, etc.

The international legal bundle added by this change provides separate EN documents and makes the legal page select content by the active UI locale. V7 now fails if the public EN legal documents are missing, contain Cyrillic, drift from their canonical copies, or the page stops selecting locale-specific documents.

## International launch scope selected

For the first hosted launch:

- Russian domestic hosted checkout remains the Russian legal/payment path.
- International hosted checkout is limited to business/professional use in jurisdictions that VibeUs and its payment provider can lawfully serve.
- New hosted accounts and paid hosted checkout are **not currently offered or intentionally targeted to the EEA or United Kingdom**, regardless of B2B/B2C label.
- Self-hosted open-source distribution remains separate and governed by repository licences/applicable law.

Why: merely writing “B2B” does not switch off privacy law for natural-person users at businesses. Enabling EEA/UK hosted sales requires a separate launch review covering territorial privacy obligations, restricted transfers/representatives where applicable, VAT/tax handling, and consumer rules if consumer sales are offered.

## BLOCKERS before `ENABLE_GLOBAL_PRICING=true`

1. Obtain written acceptance of the actual hosted VibeUs SaaS use case from the selected international payment provider.
2. Complete provider KYC with accurate identity/residence/business-purpose information.
3. Implement the real provider checkout route and verified webhook -> local Payment ledger -> idempotent entitlement transition.
4. Collect/validate billing country before international checkout.
5. Enforce the current EEA/UK hosted-availability restriction server-side rather than relying on marketing copy or browser locale/IP alone.
6. Require an explicit international business/professional-use representation before paid checkout while that is the launch scope.
7. Determine the applicable tax treatment for each enabled sales geography/provider flow. Do not assume that USD pricing determines tax location.
8. Update `/legal/subprocessors` with the provider's correct legal entity, role, data categories and processing/transfer locations when it actually becomes active.
9. Run a real end-to-end payment smoke test with the actual provider, including duplicate webhook delivery, amount mismatch, currency mismatch, unknown invoice, refund, failed payment and delayed webhook cases.
10. Ensure production `VITE_LEGAL_VERSION` matches the published multilingual legal bundle.

## EEA/UK later-launch checklist

Before intentionally offering the hosted service in the EEA/UK, review and implement as applicable:

- GDPR / UK GDPR territorial scope and controller/processor notices;
- EEA/UK representative requirement or documented exception;
- restricted-transfer mechanism and transfer impact/risk assessment;
- DPA transfer annexes (SCCs and/or UK IDTA/Addendum where applicable);
- EU Non-Union OSS / other VAT registration and evidence requirements;
- UK digital-services VAT treatment;
- consumer pre-contract information, order-button/payment wording and withdrawal/cancellation rules if B2C is offered;
- cookie/analytics consent if non-essential tracking is introduced; and
- local mandatory terms/complaint rights for specifically targeted countries.

## Translation/UX observations

The V7 English product copy reviewed for the primary landing/create/dashboard path is generally natural and clear. Remaining quality debt is mostly stylistic rather than a launch-language blocker. One stale public landing link still references `AlexeyPlaton/Vibus` instead of `AlexeyPlaton/VibeUs`; fix it in a follow-up UI cleanup. Some decorative/product labels remain hardcoded English rather than i18n keys, which is harmless for an English customer but produces mixed-language presentation in RU and should be gradually moved into locale files.

## Legal bundle created

English international documents:

- International Business Terms
- International Privacy Notice
- International DPA
- International Privacy Consent Notice
- International Subprocessors & Service Providers
- International Retention & Deletion Policy
- International Payments, Cancellation & Refund Policy
- International Acceptable Use Policy
- International Security Policy
- International Cookie & Local Storage Notice

The Russian hosted-service legal bundle remains unchanged and continues to govern its existing Russian scope.

## Source-law checkpoints used for the launch decision

The review considered the current texts/guidance for Russian personal-data localisation/cross-border notification, GDPR territorial scope/representative and processor obligations, UK GDPR overseas applicability, EU distance/digital-service consumer rights, and EU/UK VAT rules for cross-border digital services. These rules change and can turn on detailed facts, so the launch gate intentionally treats EEA/UK activation and each new payment geography as a separate compliance event rather than claiming universal “global compliance.”
