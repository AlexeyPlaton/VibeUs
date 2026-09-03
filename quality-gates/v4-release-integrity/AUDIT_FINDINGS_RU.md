# Независимый аудит snapshot 2026-09-02

Я не принимал заявленные агентами `53 passed / RELEASE: PASS` как доказательство корректности. Проверка велась по фактическому review snapshot и исполняемым путям.

## P0 — YooKassa checkout может существовать без локального Payment

В real и mock ветках ошибка `db.commit()` перехватывается и превращается в warning, после чего функция всё равно возвращает `confirmation_url`. Webhook, напротив, отказывается выдавать entitlement неизвестному `provider_payment_id`. Это создаёт класс отказа **«пользователь оплатил, backend не знает платеж»**.

Требуемый invariant: checkout response с URL не существует без durable local intent. Ошибка ledger => rollback + 5xx.

## P1 Security — `payment.canceled` доверяет имени webhook event

После provider GET/re-fetch ветка `payment.succeeded` сверяет реальный `payment_obj.status == succeeded`, но `payment.canceled` безусловно пишет `canceled` только по входящему `event`. Официальная документация YooKassa рекомендует проверять подлинность уведомления, в частности текущим статусом объекта.

Reference: https://yookassa.ru/developers/using-api/webhooks

## P1 Fiscal auditability — buyer identity не принадлежит Payment

Для B2B запрос содержит INN/name, но `Payment` их не хранит; `manage_receipts list` берёт email из текущего Workspace. Если email/INN/name workspace изменятся между оплатой и выдачей чека, оператор видит уже другую сущность покупателя.

Для НПД это не декоративная деталь: ФНС указывает, что для платежа от организации/ИП при формировании чека выбирается соответствующий тип клиента и указываются ИНН и название организации.

Reference (ФНС, публикация 2026): https://www.nalog.gov.ru/rn40/news/tax_doc_news/16645245/

## P1 — fiscal state machine не защищена на уровне БД

`tax_mode` и `fiscal_status` — свободные String columns. Сейчас корректность держится только на Python-переходах. Любой будущий maintenance script, migration, импорт или регресс в сервисе способен записать невозможное состояние. Новый gate делает прямые SQL inserts после Alembic `upgrade head`, поэтому grep/валидация только в ORM не помогут.

## P1 Security — legacy public widget key fail-open

Историческая migration добавляет `public_widget_key_digest` nullable. В public feedback путь проверяет digest только если он существует. Для legacy project с NULL digest обязательный header есть, но его значение фактически не аутентифицируется. Исправление должно быть fail-closed и требовать owner-side provisioning/rotation, при этом configured public widget обязан продолжить работать.

## Release evidence — присланный snapshot всё ещё не тот artifact, который описан в walkthrough

Фактический файл snapshot:

- содержит `openspec-core/dockerfile`;
- не содержит exact marker `openspec-core/Dockerfile`;
- не содержит marker `run_release_gate.py`;
- не содержит marker `scripts/render_pricing.py`.

Поэтому текущий txt нельзя использовать как доказательство состояния commit `beaac26`. Новый verifier требует exact Git path casing, clean tree, exact `GIT HEAD` внутри artifact и сравнивает content hashes critical files с repository working tree.

## Дополнительный migration warning, не включённый в автоматический v4 fix scope

`9bc026dc6e3a` добавляет nullable `projects.api_token_digest` и затем удаляет старый plaintext `api_token` без видимого backfill. Для уже существовавшего до этой migration проекта исходный secret восстановить невозможно. Поскольку проект ещё не был публично открыт, это не должно блокировать новый код само по себе, но **до рынка** стоит проверить production:

```sql
SELECT id, slug
FROM projects
WHERE is_deleted = false
  AND api_token_digest IS NULL;

SELECT id, slug
FROM projects
WHERE is_deleted = false
  AND public_widget_key_digest IS NULL;
```

Для найденных строк — owner-side rotation/re-provisioning ключей. Старые опубликованные migrations не переписывать.
