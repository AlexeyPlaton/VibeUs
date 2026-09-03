# Официальные источники для V5

Проверено 2026-09-02.

1. ЮKassa — формат взаимодействия / идемпотентность:
   https://yookassa.ru/developers/using-api/interaction-format
   - повтор с теми же параметрами и тем же `Idempotence-Key` возвращает результат исходной операции;
   - те же данные с другим ключом считаются новой операцией;
   - ключ обязателен для POST/DELETE и поддерживается 24 часа.

2. ЮKassa — обработка ответов:
   https://yookassa.ru/developers/using-api/response-handling/recommendations
   - анализируется не только HTTP code, но и состояние объекта;
   - при неопределенном результате повторяют запрос с тем же ключом либо делают GET объекта.

3. ЮKassa — webhooks:
   https://yookassa.ru/developers/using-api/webhooks
   - среди поддерживаемых событий есть `refund.succeeded`.

4. ЮKassa — возвраты:
   https://yookassa.ru/developers/payment-acceptance/after-the-payment/refunds
   - объект возврата имеет собственный `id` и отдельный `payment_id` исходного платежа;
   - возвраты могут быть полными и частичными.

5. ФНС — аннулирование чека самозанятого при возврате средств:
   https://www.nalog.gov.ru/rn29/ifns/imns29_04/info/16643589/
   - возврат денег заказчику является основанием для аннулирования чека;
   - факт provider refund сам по себе не означает, что действие в «Мой налог» уже выполнено.
