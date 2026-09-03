# Ожидаемые падения на snapshot `(9)` до исправлений

Независимый аудит текущего snapshot обнаружил следующие реальные semantic failures, которые этот gate должен ловить:

1. `create_ticket(commit=False)` делает `db.add(ticket)`, но не `await db.flush()`; `ticket.id` до outer commit может быть `None`.
2. `feedback.converted_ticket_id = ticket.id` и `discussion.created_ticket_ids += [ticket.id]` поэтому могут сохранить `None`; повтор conversion создаёт duplicate.
3. `create_ticket` уже делает `project.revision += 1`, а оба conversion helpers делают ещё один `project.revision += 1`: один action = `+2`.
4. Stable fingerprint присутствует в WS auth, но typed REST `getHeaders()` и `fetchBoard()` не отправляют `X-Device-Fingerprint`; activated single-use link ломает REST/resync.
5. WS status/comment/checklist меняют ticket, но не увеличивают `ticket.revision`; stale REST `If-Match` может затереть WS изменение.
6. Duplicate WS ACK отправляется без `revision`; web queue безусловно вызывает `setRevision(ack.revision)`.
7. `auth_ok.capabilities` backend отправляет, frontend их игнорирует; `client_preview` выглядит как Studio и предлагает forbidden controls.
8. create/convert frontend handlers сохраняют temporary IDs и fire-and-forget REST response; при WS outage local identity расходится с server identity.
9. `create_ticket(commit=False)` пропускает Telegram/GitHub side effects, поэтому converted ticket отличается по поведению от обычного create.
10. `ENABLE_MCP_WRITE` и `ENABLE_PUBLIC_TUNNELS` используются в production config validation, но не защищают соответствующие runtime routes.
11. `ttl=forever` access link превращается в TunnelSession с fallback `+7 days`.
12. Snapshot export показывает lowercase physical filenames при PascalCase imports; это требует case-sensitive Linux proof.

Это не Definition of Done само по себе. Истиной является исполняемый gate + regression matrix + staging smoke.
