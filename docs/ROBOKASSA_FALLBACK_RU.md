# Robokassa как резервный международный платежный контур VibeUs

Статус: **readiness / выключено по умолчанию**.

Robokassa добавлена как независимый резервный канал к LAVA для приема платежей банковскими картами, в том числе картами иностранных банков в тех странах и для тех merchant-категорий, которые реально включены Robokassa для аккаунта VibeUs.

Официальная документация Robokassa описывает hosted payment form `https://auth.robokassa.ru/Merchant/Index.aspx`, подпись платежного запроса с Паролем #1 и проверку серверного `ResultURL` с Паролем #2. `OutSum` в классическом merchant form задается в RUB; валюта/способ, которым платит покупатель, может отличаться от валюты зачисления магазину.

Актуальные ссылки:

- https://docs.robokassa.ru/ru/iframe
- https://docs.robokassa.ru/ru/notifications-and-redirects
- https://docs.robokassa.ru/ru/testing-mode
- https://docs.robokassa.ru/ru/xml-interfaces

## Почему это fallback, а не автоматический retry

VibeUs **не должен** после timeout/неоднозначной ошибки создания счета у LAVA автоматически создавать второй счет в Robokassa. Первый провайдер мог принять запрос, даже если наш сервер не получил ответ. Автоматический retry во втором процессинге создаст две платежные возможности для одной покупки и усложнит reconciliation/refund.

Провайдер выбирается до создания внешнего счета. Fallback допустим, когда основной провайдер заранее недоступен для страны/merchant policy либо оператор явно переключил routing policy.

## Конфигурация

```env
GLOBAL_BILLING_PROVIDER=lava
GLOBAL_BILLING_FALLBACK_PROVIDER=robokassa

ENABLE_ROBOKASSA=false
ROBOKASSA_PAYMENT_URL=https://auth.robokassa.ru/Merchant/Index.aspx
ROBOKASSA_MERCHANT_LOGIN=
ROBOKASSA_PASSWORD1=
ROBOKASSA_PASSWORD2=
ROBOKASSA_HASH_ALGORITHM=sha256
ROBOKASSA_IS_TEST=false
```

Метод хэширования обязан совпадать с техническими настройками магазина Robokassa.

## Важная ценовая граница

Текущий International catalog VibeUs выражен в USD (`PRICE_USD_SOLO`, `PRICE_USD_STUDIO`), тогда как `OutSum` классической формы Robokassa задается в RUB. Поэтому readiness adapter **не конвертирует USD сам** и не подменяет валюту.

Перед production activation необходимо выбрать и реализовать явную политику price snapshot, например:

1. Robokassa-specific RUB international price, опубликованный покупателю до перехода к оплате; либо
2. проверяемый FX snapshot с источником курса, временем и сохранением исходной USD цены + расчетной RUB суммы в `Payment` ledger.

Нельзя незаметно трактовать `$29` как `29 RUB` или рассчитывать курс только в браузере.

## Что уже реализовано

`openspec-core/robokassa_service.py`:

- fail-closed при `ENABLE_ROBOKASSA=false`;
- формирование hosted payment URL;
- нормализация `OutSum`;
- подпись checkout с Паролем #1;
- проверка ResultURL signature с Паролем #2;
- выбор `en`/`ru` payment UI;
- тестовый флаг;
- секреты не попадают в URL.

## Что необходимо до включения

1. Зарегистрировать/верифицировать merchant VibeUs в Robokassa.
2. Получить от Robokassa подтверждение допустимости hosted SaaS VibeUs и включения иностранных карт для нужной географии.
3. Настроить ResultURL/SuccessURL/FailURL.
4. Реализовать создание локального `Payment(status=pending, provider=robokassa)` **до** перехода пользователя к провайдеру.
5. Выделить collision-safe положительный integer `InvId` и связать его с конкретным `Payment`.
6. В ResultURL проверить не только подпись, но и локально ожидаемые `InvId`, `OutSum`, provider и pending-state.
7. Сделать callback идемпотентным.
8. Не выдавать entitlement по SuccessURL браузера.
9. Реализовать refund/reconciliation path.
10. Прогнать Robokassa test mode, затем разрешенный реальный платеж и возврат.
11. Обновить публичный Subprocessors/Payments документ фактическими реквизитами провайдера после activation.

До выполнения этих пунктов `ENABLE_ROBOKASSA=false`.
