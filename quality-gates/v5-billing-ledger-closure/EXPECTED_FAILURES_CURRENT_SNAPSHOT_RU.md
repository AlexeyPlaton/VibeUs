# Expected RED на snapshot после заявленного V4 PASS

На переданном snapshot V5 должен обнаружить минимум:

1. текущий Alembic head все еще `a3b4c5d6e7f8`, новой forward migration для V5 нет;
2. `receipt_issued` DB CHECK не требует `status=succeeded AND tax_mode=npd`;
3. отсутствует `Payment.buyer_snapshot_verified`;
4. B2B request допускает `is_b2b=true` без INN/name;
5. YooKassa 2xx без confirmation URL fallback-ится на `return_url`;
6. `create_yookassa_payment` не принимает caller idempotency key и генерирует новый UUID на каждый вызов;
7. нет `PaymentRefund`/durable `refund.succeeded` lifecycle;
8. нет NPD `receipt_refund_required` operator reconciliation;
9. переданный txt не содержит настоящих critical file markers и top-level Git self-identification.

Если этот snapshot неожиданно дает V5 PASS без новых production changes/new migration, gate запущен не против нужного root/artifact либо gate изменен.
