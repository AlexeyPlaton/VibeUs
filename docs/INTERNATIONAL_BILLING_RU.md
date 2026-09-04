# Международный биллинг VibeUs (оператор из РФ)

Этот документ описывает текущую техническую и операционную готовность международной hosted-оплаты VibeUs. Это runbook для запуска, а не юридическая, налоговая, банковская или санкционная консультация.

Вопросы по hosted VibeUs и оплате: **support@vibeus.pro**.

## Текущая целевая архитектура

- Российский hosted checkout остаётся на YooKassa в RUB.
- Международный hosted checkout подготовлен через **CloudPayments**.
- Международные цены задаются единым backend-каталогом; браузер не является источником истины по сумме или entitlement.
- Stripe остаётся опциональным адаптером для self-hosting операторов, которые самостоятельно имеют право им пользоваться.
- LAVA.TOP остаётся необязательным кандидатом для отдельно согласованных сценариев и больше не является canonical provider для hosted VibeUs.
- `ENABLE_GLOBAL_PRICING` и `ENABLE_CLOUDPAYMENTS` остаются выключенными до готовности реального merchant account.

VibeUs использует оплату, которая выдаёт доступ на `BILLING_PERIOD_DAYS`. Успешный redirect браузера сам по себе никогда не должен открывать платный тариф: entitlement меняется только после проверенного server-to-server события провайдера.

## Конфигурация провайдера

До merchant approval значения должны оставаться выключенными/пустыми:

```env
ENABLE_GLOBAL_PRICING=false
GLOBAL_BILLING_PROVIDER=cloudpayments
ENABLE_CLOUDPAYMENTS=false
CLOUDPAYMENTS_PUBLIC_ID=
CLOUDPAYMENTS_API_SECRET=
CLOUDPAYMENTS_API_BASE_URL=https://api.cloudpayments.ru
CLOUDPAYMENTS_GLOBAL_CURRENCY=USD
```

`CLOUDPAYMENTS_PUBLIC_ID` идентифицирует терминал и может передаваться в клиентский provider flow. `CLOUDPAYMENTS_API_SECRET` — серверный секрет; он не должен попадать в браузер, логи, frontend bundle или публичный репозиторий.

Перед включением production checkout необходимо получить и проверить для конкретного merchant account:

1. одобрение сайта/мерчанта CloudPayments;
2. возможность принимать нужные иностранные карты и валюту;
3. реальные `PUBLIC_ID` и `API_SECRET`;
4. фактический порядок расчётов/вывода и комиссии;
5. фискальный сценарий для выбранного налогового режима;
6. допустимую географию покупателей и иные ограничения договора.

Не обходите KYC, country, ownership или business-purpose ограничения недостоверными данными.

## Webhook / notification contract

В merchant cabinet настройте HTTPS-уведомления на production-домен:

```text
Check  -> https://YOUR_DOMAIN/api/billing/cloudpayments/check
Pay    -> https://YOUR_DOMAIN/api/billing/cloudpayments/pay
Fail   -> https://YOUR_DOMAIN/api/billing/cloudpayments/fail
Refund -> https://YOUR_DOMAIN/api/billing/cloudpayments/refund
```

Текущий backend проверяет HMAC уведомления и связывает платёж с локальным ledger по ожидаемым данным, включая сумму, валюту и workspace/payment identity. Повторная доставка должна быть идемпотентной: повторный валидный webhook не должен повторно выдавать entitlement или искажать состояние платежа.

`Pay` — единственный путь к успешному settlement после серверной проверки. `Fail` не выдаёт entitlement. `Refund` должен отражать возврат в локальном ledger в соответствии с текущим контрактом. `Check` используется для предварительной серверной валидации ожидаемого платежа.

Никогда не открывайте тариф только потому, что браузер вернулся на `success_url`.

## Billing country и текущий международный scope

Перед международным checkout VibeUs собирает billing country и подтверждение business/professional use. Решение о доступности принимает backend, а не язык интерфейса, IP или скрытый список стран в браузере.

Текущий hosted scope **не предлагает и намеренно не таргетирует новые платные hosted-продажи в EEA и UK**. Эти страны остаются видимыми в выборе страны, чтобы пользователь получил явное серверное объяснение недоступности вместо тихого исчезновения страны из формы.

Расширение в EEA/UK — отдельное compliance-событие и требует отдельного review по privacy, transfers/representative, VAT/consumer obligations и условиям провайдера.

## НПД / фискальная часть

Текущий backend поддерживает `BILLING_TAX_MODE=npd` и `kkt_54fz`, но наличие технического флага не заменяет проверку реального merchant/fiscal договора.

Для production запуска нужно отдельно подтвердить:

- кто формирует обязательный чек и в какой момент;
- какие данные покупателя обязательны;
- как отражаются возвраты;
- как соотносятся provider receipt, локальный payment ledger и «Мой налог»/ККТ в выбранном режиме;
- что настройки YooKassa и CloudPayments не создают две конкурирующие фискальные цепочки для одной операции.

До этой проверки `ENABLE_CLOUDPAYMENTS=false` — намеренный fail-closed default.

## Production smoke test перед включением

До `ENABLE_GLOBAL_PRICING=true` выполните реальный разрешённый end-to-end тест на конкретном merchant account и проверьте как минимум:

- успешный платёж;
- повторную доставку `Pay`;
- неверную HMAC-подпись;
- несовпадение суммы;
- несовпадение валюты;
- неизвестный payment/workspace;
- `Fail`;
- `Refund`;
- задержанный webhook после browser return;
- отсутствие entitlement до проверенного `Pay`;
- корректный фискальный результат и запись в локальном ledger.

После smoke test сверьте dashboard/ledger с фактическим merchant cabinet и банковским/фискальным результатом.

## Go-live checklist

International hosted checkout остаётся **NO-GO**, пока не выполнены все пункты:

- CloudPayments merchant/site одобрен для фактического VibeUs SaaS use case;
- KYC заполнен правдивыми данными оператора;
- нужные иностранные карты/валюта разрешены для терминала;
- production credentials установлены только server-side;
- Check/Pay/Fail/Refund notifications настроены на production HTTPS endpoints;
- проверены HMAC, amount/currency/workspace binding и idempotency;
- подтверждена налоговая/фискальная схема конкретного merchant account;
- подтверждён payout route и комиссии;
- актуализированы legal/subprocessor данные для реально включённого провайдера;
- пройден реальный end-to-end payment/refund smoke test;
- только после этого включены `ENABLE_CLOUDPAYMENTS=true` и `ENABLE_GLOBAL_PRICING=true`.

Если фактический договор CloudPayments или доступность иностранного эквайринга расходятся с этим runbook, **договор/merchant cabinet важнее документации**: оставьте international checkout выключенным и обновите контракт приложения до включения продаж.
