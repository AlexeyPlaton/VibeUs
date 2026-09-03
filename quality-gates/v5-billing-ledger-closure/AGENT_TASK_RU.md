# Задание AI-агенту — VibeUs V5 Billing Ledger Closure

Работай с production-кодом и **новыми forward migrations**. V4 и V5 gate-файлы менять запрещено.

## 1. Fiscal DB state machine

`a3b4c5d6e7f8` уже считается опубликованной миграцией. Не редактируй ее.

Создай новый Alembic revision после текущего head. База обязана отвергать как минимум:

- `fiscal_status=receipt_issued` при `status != succeeded`;
- `fiscal_status=receipt_issued` при `tax_mode != npd`;
- `receipt_issued` без URL/timestamp;
- verified buyer snapshot без email;
- verified B2B snapshot без непустых ИНН и наименования.

Положительные состояния (`pending/not_required`, `succeeded/npd/required`, `succeeded/npd/issued`, `succeeded/kkt/not_required`) должны остаться рабочими.

## 2. Legacy buyer snapshot не должен притворяться достоверным

Добавь в `Payment` явный признак достоверности snapshot (контракт тестов: `buyer_snapshot_verified: bool`).

- Новые checkout-записи создаются с `buyer_snapshot_verified=True`.
- Все строки, существовавшие до новой миграции, должны после upgrade оставаться `False`, пока оператор не сверит данные.
- Можно best-effort backfill `buyer_email` из исторически немутируемого `Workspace.owner_email`, но это **не делает legacy snapshot verified**.
- `manage_receipts.mark_receipt_issued()` обязан fail-closed при `buyer_snapshot_verified=False`.
- Добавь `manage_receipts.reconcile_buyer_snapshot(...)` и CLI-команду `reconcile-buyer`. Она валидирует email; для B2B требует ИНН + наименование, меняет snapshot, ставит verified и пишет AuditEvent `billing.npd_buyer_snapshot_reconciled`.

Не подставляй текущие реквизиты Workspace и не называй их immutable history без explicit reconciliation.

## 3. B2B consistency

`CreateYookassaPaymentRequest` должен отклонять `is_b2b=true`, если отсутствует/пустой `company_inn` или `company_name`.

Ту же инварианту защищает БД для **verified** buyer snapshots.

## 4. YooKassa checkout response + idempotency

Для redirect checkout 2xx от провайдера не считается успехом без:

- непустого provider payment `id`;
- непустого `confirmation.confirmation_url` с HTTPS URL.

Нельзя fallback-ить `confirmation_url` на `return_url`.

Поддержи caller-provided `Idempotency-Key` (макс. 64 символа) и передавай **тот же** ключ в YooKassa. Повтор запроса с тем же ключом и теми же данными должен вернуть тот же provider payment и не создавать вторую локальную `Payment` запись/500 на unique constraint. Новый ключ означает новую попытку.

## 5. Refund ledger + NPD reconciliation

`refund.succeeded` — отдельный тип объекта ЮKassa: `object.id` — refund id, исходный payment находится в `object.payment_id`.

Нужен durable idempotent refund ledger (`PaymentRefund` по контракту tests):

- unique provider refund id;
- ссылка на локальный Payment;
- amount minor units/currency/status/timestamps;
- provider verification идет через refund endpoint, а не `GET /payments/{refund_id}`;
- forged/non-succeeded refund не меняет ledger;
- duplicate webhook не дублирует refund;
- при полном возврате локальный Payment становится `refunded`;
- для NPD платежа, если чек уже был выдан, успешный возврат переводит fiscal state в `receipt_refund_required`.

Добавь операторский путь в `manage_receipts.py` для подтверждения фактической корректировки/аннулирования чека в «Мой налог»; итог должен иметь отдельное состояние и AuditEvent. Нельзя автоматически утверждать, что чек в ФНС аннулирован только потому, что YooKassa вернула деньги.

## 6. Review artifact identity

V5 runner должен получать **тот самый txt**, который передается аудитору. `verify_delivered_snapshot.py` печатает его SHA-256. Этот SHA обязан быть вставлен в walkthrough/отчет агента без ручного пересчета.

Artifact обязан содержать реальные top-level markers:

- `--- GIT HEAD: <40 hex> ---`;
- `--- GIT DIRTY: false ---`;
- `--- Файл: openspec-core/Dockerfile ---`;
- `--- Файл: run_release_gate.py ---`;
- `--- Файл: scripts/render_pricing.py ---`.

Строка `MISSING --- Файл: ...` внутри старого отчета не считается marker.

## Финальная команда

```powershell
powershell -ExecutionPolicy Bypass -File .\quality-gates\v5-billing-ledger-closure\scripts\run-v5.ps1 `
  -ProjectRoot . `
  -Snapshot .\REVIEW_SNAPSHOT.txt
```

В ответе приложи полный stdout, `git diff --check`, `git status --short`, `alembic heads`, новый revision ID и строку `DELIVERED SNAPSHOT SHA256: ...`.
