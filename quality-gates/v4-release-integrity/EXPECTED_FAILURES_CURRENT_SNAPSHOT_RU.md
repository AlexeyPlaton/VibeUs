# Expected RED — snapshot 2026-09-02

На присланном snapshot до исправления ожидаются как минимум:

- real YooKassa ledger `commit()` exception проглатывается warning и checkout URL возвращается;
- mock YooKassa ledger `commit()` exception также проглатывается;
- `payment.canceled` меняет `Payment.status` без проверки `payment_obj.status == canceled`;
- `Payment` не содержит immutable buyer snapshot fields;
- `manage_receipts list` читает `workspace.owner_email` и не имеет payment-level B2B INN/name;
- DB принимает произвольный `tax_mode/fiscal_status` и нелогичные receipt states;
- legacy project с `public_widget_key_digest=NULL` принимает любой непустой public key header;
- присланный review artifact содержит `openspec-core/dockerfile`, но не exact marker `openspec-core/Dockerfile`;
- присланный review artifact не содержит root markers `run_release_gate.py` и `scripts/render_pricing.py`;
- текущий exporter не доказывает exact Git HEAD/clean state в самом artifact.

Если этот snapshot внезапно даёт full v4 PASS без production changes, gate либо изменён, либо запускается не против того repository root/snapshot.
