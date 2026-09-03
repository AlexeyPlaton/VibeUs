# VibeUs International Retention & Deletion Policy

**Version:** 2026-09-03-international-1.0

The following operational retention periods describe the canonical hosted VibeUs service. A shorter period may apply where required by law or a valid deletion instruction; a longer period applies only where necessary for a mandatory legal, tax, payment, fraud-prevention, security, or dispute purpose.

| Data category | Normal operational period | End trigger | Action |
|---|---:|---|---|
| Active account/workspace data | while account/agreement is active | account deletion/termination | delete or de-identify except mandatory records |
| Browser sessions | up to 7 days or until revoked | expiry/logout/revoke | delete/revoke |
| Live Preview sessions | no longer than applicable tunnel TTL, up to 30 days | expiry/revoke | delete/clear |
| Project content and feedback | until project/account deletion or Customer instruction | deletion/instruction | remove from active database |
| Security/audit logs | 90 days under normal operation | security/claims need expires | delete or aggregate |
| Payment ledger / mandatory accounting records | 5 years under the current Russian accounting record rule, or another period if applicable law requires | mandatory retention expires | securely delete after applicable period |
| Closed support records | 1 year after closure under normal operation | closure + retention period | delete or de-identify |
| Backups | up to 30 days | backup rotation | expire/destroy through backup lifecycle |

## Active deletion

Deleting a project/account should initiate server-side deletion/revocation rather than merely hiding the object in the user interface. Access tokens, access links, preview sessions and relevant integration secrets associated solely with deleted resources should be revoked or removed as part of the deletion lifecycle.

## Backups

Backups are not normally edited item-by-item. Deleted data may persist temporarily in encrypted/restricted backup copies until the backup expires through the normal cycle, currently up to 30 days. A restored backup must be reconciled with applicable deletion/tombstone records before normal production use.

## External integrations

Sending data to GitHub, an AI/model provider, a messaging service, payment provider, or another Customer-selected external system can create a separate copy controlled by that provider/customer. Deleting the VibeUs copy does not automatically guarantee deletion from an external system where VibeUs does not control or have an API right to delete that copy.

## Legal holds and mandatory records

VibeUs may retain a limited record beyond the normal period when reasonably necessary to comply with law, tax/accounting obligations, payment disputes, fraud prevention, sanctions/compliance checks, or establishment/exercise/defence of legal claims. Such data must not be reused for unrelated product purposes merely because it is retained.

## Requests

Account/privacy deletion requests: `privacy@vibeus.pro`  
Billing record questions: `support@vibeus.pro`
