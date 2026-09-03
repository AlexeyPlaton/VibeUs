# VibeUs Quality Gate v5 — Billing Ledger Closure

Этот gate добавляется **поверх V4 Release Integrity**. Он не заменяет V4 и официальный `run_release_gate.py`.

## Зачем нужен V5

V4 закрыл исходные P0/P1, но зеленый V4 оставил непроверенными соседние состояния:

1. `receipt_issued` в БД можно было записать для `pending`/`kkt_54fz`, если URL и timestamp заполнены.
2. Legacy платежи после миграции получили новые buyer-поля как `NULL`, но операторский поток не отличает настоящий checkout snapshot от отсутствующей исторической информации.
3. `is_b2b=true` принимается без обязательных ИНН/наименования.
4. YooKassa 2xx без `payment.id` или redirect `confirmation_url` трактуется как успешный checkout; `confirmation_url` подменяется `return_url`.
5. Каждый checkout генерирует новый `Idempotence-Key`, поэтому повтор той же операции не является безопасным retry.
6. ЮKassa посылает `refund.succeeded`, но локальный ledger не имеет исполняемого refund lifecycle; для NPD после возврата нужен отдельный операторский fiscal action.
7. Review handoff все еще может проверить один файл, а передать аудитору другой. V5 печатает SHA-256 именно переданного artifact.

## Definition of Done

V5 считается зеленым только если:

```text
python quality-gates/v5-billing-ledger-closure/verify_integrity.py
pytest -q quality-gates/v5-billing-ledger-closure/tests
python quality-gates/v5-billing-ledger-closure/scripts/verify_delivered_snapshot.py --snapshot <review.txt>
# затем без изменений должен пройти V4 runner, который сам запускает официальный release gate
```

На Windows используйте `scripts/run-v5.ps1`, на Linux/macOS — `scripts/run-v5.sh`.

## Anti-cheat

Нельзя менять V4/V5 tests ради PASS, переписывать опубликованные migrations, удалять B2B/refund/checkout функциональность, заменять runtime-проверки grep-строками или выдавать за проверенный snapshot файл с другим SHA-256.
