# Data Map VibeUs — заполнить перед production

| Поток | VibeUs роль | Поля | Цель | Основание | Primary storage | Получатели | Retention |
|---|---|---|---|---|---|---|---|
| Регистрация | оператор | email, password hash, first_touch_source | аккаунт/договор | исполнение договора (п. 5 ч. 1 ст. 6 152-ФЗ) | РФ SQLite / PostgreSQL | hosting | срок жизни аккаунта + 30 дней |
| First-touch attribution | оператор | UTM / source tag, timestamp | оценка каналов запуска | законный интерес оператора / исполнение договора | РФ DB | нет (first-party) | срок жизни workspace |
| Security logs | оператор | IP, UA, event | безопасность/аудит | законный интерес оператора | РФ logs | hosting | 90 дней |
| Billing | оператор | email, plan, amount, provider id | оплата/учет | договор + ст. 29 402-ФЗ | РФ DB | YooKassa | 5 лет |
| Public feedback | обработчик | text, optional contact, locator | поручение клиента | DPA / поручение клиента | РФ DB | клиент | до удаления проекта клиентом |
| GitHub sync | обработчик/по инструкции | ticket text/context | integration | инструкция клиента | GitHub | GitHub | по правилам GitHub |
| Telegram notify | обработчик/по инструкции | ticket/feedback excerpt | уведомление | инструкция клиента | Telegram | Telegram | транзитно / не сохраняется в отдельном логе |
| External AI | обработчик/по инструкции | минимальный payload задачи | code assistance | инструкция клиента | РФ / по выбору клиента | настроенный провайдер | транзитно в рамках сессии |

**Красный флаг:** GitHub/Telegram/external AI могут создавать трансграничные потоки и отдельные копии данных. Не включать их для ПД «по умолчанию» без конфигурации и legal/data-flow review.
