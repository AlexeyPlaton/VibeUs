# Независимый аудит после V4 — найденные gaps

## P0/P1 — неполный DB invariant `receipt_issued`

Миграция `a3b4c5d6e7f8` проверяет для `receipt_issued` только `receipt_url IS NOT NULL AND receipt_issued_at IS NOT NULL`. Поэтому прямой SQL все еще может создать `pending + npd + receipt_issued` или `succeeded + kkt_54fz + receipt_issued` с заполненной ссылкой/датой.

## P1 — legacy buyer identity остается неизвестной

`a3b4...` добавляет buyer-поля nullable и не маркирует старые строки как непроверенные. `manage_receipts list` превращает NULL в пустую строку. Нужен explicit verified/unverified lifecycle, иначе новый immutable snapshot существует только для новых checkout.

## P1 — B2B можно создать без fiscal identity

`CreateYookassaPaymentRequest` разрешает `is_b2b=true` вместе с `company_inn=None/company_name=None`. Новый Payment затем честно и навсегда сохраняет неполный B2B snapshot.

## P1 — malformed 2xx YooKassa маскируется под checkout

При отсутствии `confirmation_url` production code использует `return_url`. Это скрывает нарушение provider contract и создает локальный pending payment, хотя пользователю некуда переходить для оплаты. Аналогично provider id должен проверяться до записи ledger.

## P1 — retry checkout не является идемпотентным

Ключ YooKassa генерируется `uuid4()` внутри каждого вызова. По документации YooKassa повтор запроса с теми же данными и тем же ключом возвращает результат исходной операции; с другим ключом запрос считается новой операцией. Поэтому caller retry должен иметь стабильный ключ и локальную дедупликацию.

## P1 Accounting — refund lifecycle отсутствует

Действующая политика VibeUs принимает запросы на возврат, YooKassa поддерживает `refund.succeeded`, а local Payment уже упоминает статус `refunded`. При этом webhook processor не обрабатывает refund object. У refund object `id` — идентификатор возврата, а `payment_id` — исходный платеж; нельзя отправлять refund id в `/payments/{id}`.

Для NPD возврат денег связан с корректировкой чека «Мой налог». Поэтому provider refund не имеет права автоматически означать `receipt reconciled`: требуется отдельный operator-side fiscal state/action.

## REVIEW — переданный файл не тот, который описан walkthrough

В переданном на аудит txt нет настоящих exact markers `openspec-core/Dockerfile`, `run_release_gate.py`, `scripts/render_pricing.py` и нет top-level self-identifying Git header. В нем присутствуют только строки старого control report `MISSING ...`. V5 добавляет SHA-256 конкретного delivered artifact.
