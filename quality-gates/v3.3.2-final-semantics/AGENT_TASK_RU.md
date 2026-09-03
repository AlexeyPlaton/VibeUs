# Vibus v3.3.2 Final Semantics Closure — обязательное задание AI-агенту

Ты работаешь **только с production-кодом репозитория openspec**. Папка этого Quality Gate является внешним oracle: **не редактировать, не удалять, не monkeypatch'ить и не обходить tests/runner/manifest**.

## Цель

Закрыть последние семантические дефекты после v3.3.1 так, чтобы система была корректна не только на happy path, но и при reconnect, single-use access, REST/WS concurrency и временном падении WebSocket.

## 1. Transactional ticket creation / conversions

В `openspec-core/crud.py`:

- `create_ticket(..., commit=False)` должен выполнить `db.add(ticket)` + **`await db.flush()`** до возврата;
- `flush()` обязателен также потому, что `SpecTicket.id` создаётся SQLAlchemy default при INSERT/flush;
- при `commit=False` запрещён промежуточный commit;
- feedback/discussion conversion должны сохранить **тот же non-null `ticket.id`** в source entity;
- повтор conversion обязан вернуть исходный ticket и не создавать второй;
- один logical conversion должен увеличить `project.revision` **ровно на 1**, а не на 2;
- repeated idempotent conversion не должен менять revision;
- quota/ticket_seq rollback должны оставаться частью внешней транзакции.

Не создавай второй отдельный ticket implementation. Используй общий `create_ticket`/transactional helper.

## 2. Unified REST + WS device identity

Стабильный `getOrCreateDeviceId()` уже есть. Один и тот же device id должен использоваться:

- в WebSocket auth `fingerprint`;
- во всех authenticated typed REST requests через `X-Device-Fingerprint`;
- в `fetchBoard()`/authoritative resync.

Нельзя генерировать новый id на каждый запрос.

Single-use invariant:

```text
WS activate token with fingerprint A
REST board/resync with same token + A => valid
same token + fingerprint B/no fingerprint => rejected
```

## 3. Cross-channel optimistic concurrency

REST `If-Match` недостаточен, если WS не меняет `ticket.revision`.

Каждый successful WS:

- `ticket.status.change`
- `ticket.comment.add`
- `ticket.checklist.change`

обязан в одной DB transaction:

```text
ticket.revision += 1
project.revision += 1
write AuditEvent
COMMIT
```

После этого stale REST `If-Match` должен получить 409.

## 4. Duplicate ACK / reconnect

Server idempotency ACK обязан содержать authoritative `revision`:

```json
{"type":"event.ack","event_id":"...","duplicate":true,"revision":123}
```

Frontend queue дополнительно должна быть defensive:

- если ACK revision — number, обновить current revision;
- если legacy/stale duplicate ACK пришёл без revision, **не присваивать `undefined`**;
- очередь всё равно должна корректно продвинуться.

## 5. Capability-driven client preview

Backend уже отправляет `auth_ok.capabilities`. Frontend обязан их реально потреблять.

Минимальный derived state:

```text
canWrite          <- project:write
canComment        <- ticket:comment
canManageSettings <- settings:manage
isReadOnly        <- !canWrite
```

`client_preview` с reviewer/tester/viewer не должен выглядеть как полноценная Studio и предлагать действия, которые гарантированно получат 403.

- Settings UI скрыть/disable без `settings:manage`;
- mutation/edit/delete controls скрыть/disable без `project:write`;
- comment controls разрешать только при `ticket:comment`;
- security всё равно остаётся на backend; UI gating — не замена RBAC.

## 6. Authoritative server IDs without relying on WebSocket

Optimistic temporary IDs разрешены только временно.

Для identity-creating actions:

- `createTicket`
- `createNode`
- `convertDiscussionToTicket`
- `convertFeedbackToTicket`

после успешного REST необходимо выполнить authoritative reconciliation (`fetchBoard`) **даже если WS отключён**.

Рекомендуемый единый helper: `persistAndReconcile` или `persistAndResync`:

```text
await REST mutation
await fetchBoard()
return server result
```

Fire-and-forget success без reconciliation запрещён.

## 7. Shared ticket-created post-commit side effects

Сейчас обычный create запускает Telegram/GitHub side effects только в `commit=True`, а atomic conversions используют `commit=False`.

Вынеси **один shared async post-commit helper** (имя свободное, но должно явно содержать ticket + created/post_commit/side_effect).

Он должен использоваться:

- обычным `create_ticket` после его успешного commit;
- feedback conversion после outer commit;
- discussion conversion после outer commit.

Side effects не должны выполняться до commit. Их failure не должен откатывать уже успешно committed ticket; логировать и продолжать согласно существующей политике интеграций.

## 8. Runtime feature flags must fail closed

`settings.py` уже содержит:

```text
ENABLE_MCP_WRITE
ENABLE_PUBLIC_TUNNELS
```

Недостаточно валидировать Redis при production startup.

- `execute_mcp_tool`: write/integration tools при `enable_mcp_write=False` должны вернуть fail-closed HTTP error; read tools можно оставить доступными согласно auth.
- `create_tunnel_session`: при `enable_public_tunnels=False` не выдавать session/access credential.

## 9. Tunnel forever semantics

Запрещено:

```text
requested forever -> silently session expires in 7 days
```

Допустимы два решения:

A. Для live tunnel явно запретить `forever` понятным 4xx и оставить access links отдельно поддерживать forever.

B. Сделать `TunnelSession.expires_at` nullable и корректно поддержать реальный no-expiry path во всех местах.

Не делать silent downgrade.

## 10. Linux/case-sensitive build

Исправь physical filename casing и imports так, чтобы exact filesystem path совпадал с import spelling.

Gate сам проверяет relative TS/TSX imports case-sensitive даже если запускается на Windows.

После исправлений обязательно выполнить frontend build также в Linux CI (`ubuntu-latest`) либо эквивалентном case-sensitive filesystem.

## Запрещено

- менять/ослаблять Quality Gate;
- добавлять grep-friendly мёртвые строки;
- ловить ошибки пустыми `catch(() => {})`;
- генерировать новый fingerprint на каждый REST call;
- рассчитывать на `board.refresh` как единственный способ получить server IDs;
- увеличивать `project.revision` дважды за один logical conversion;
- делать side effects до outer commit;
- обходить capability UI только CSS-ом при сохранении активных mutation handlers;
- утверждать production GO только по локальному Windows build.

## Definition of Done

1. v3.3.2 pytest: **12/12 PASS**.
2. v3.3.2 Node runtime: **3/3 PASS**.
3. `openspec-web npm run build:all`: **PASS**.
4. v3.3.1: **16/16 + build PASS** без изменения gate.
5. v3.3: **30/30 PASS** без изменения gate.
6. v3.2 + вся предыдущая regression matrix: **PASS**.
7. Linux/case-sensitive frontend build: **PASS**.
8. Staging `/widget.js` + `/widget.css`: **200**, non-empty.

В финальном отчёте перечисли **production-файлы**, объясни каждое изменение и приложи полный stdout всех прогонов. Не пиши «готово», если любой пункт не подтверждён выводом команды.
