# Vibus Quality Gate v3.3.2 — Final Semantics Closure

Это **последний узкий code-level gate** после v3.3.1. Он закрывает не новые фичи, а реальные семантические щели, найденные независимым аудитом snapshot `(9)`.

## Состав

- **12 pytest**: backend runtime semantics + frontend/source contracts;
- **3 Node runtime tests**: WebSocket duplicate ACK/reconnect и реальный REST fingerprint header;
- **`openspec-web npm run build:all`**;
- отдельный **staging static smoke** для `/widget.js` и `/widget.css`.

## Что именно закрывается

1. `create_ticket(commit=False)` обязан materialize `ticket.id` через flush, не делая commit.
2. Feedback conversion: один реальный ticket, non-null linkage, повтор идемпотентен, один logical revision.
3. Discussion conversion: то же самое.
4. WS ticket mutation увеличивает **и project.revision, и ticket.revision**.
5. Duplicate `event.ack` содержит authoritative project revision; клиент не портит revision при старом ACK без поля revision.
6. Single-use fingerprint идёт не только в WS auth, но и во все authenticated REST calls + `fetchBoard`.
7. `ENABLE_MCP_WRITE` и `ENABLE_PUBLIC_TUNNELS` реально fail-closed на runtime routes.
8. Tunnel `forever` не может молча становиться 7 днями.
9. `client_preview` обязан потреблять backend capabilities и быть capability-driven/read-only.
10. Identity-creating UI actions (`createTicket/createNode/convert*`) после server success делают authoritative reconciliation независимо от WS.
11. Ticket-created side effects после conversion не расходятся с обычным create.
12. Relative TS/TSX imports проверяются **case-sensitive даже на Windows**, чтобы локальный PASS не скрывал Linux production failure.

## Запуск Windows

```powershell
cd C:\path\to\Vibus-quality-gate-v3.3.2-final-semantics
python -m pip install -r C:\workspace\Desktop\openspec\openspec-core\requirements.lock
python -m pip install -r .\requirements.txt
.\scripts\run-v3.3.2.ps1 -ProjectRoot C:\workspace\Desktop\openspec
```

## Запуск Linux/macOS

```bash
cd /path/to/Vibus-quality-gate-v3.3.2-final-semantics
python -m pip install -r /path/to/openspec/openspec-core/requirements.lock
python -m pip install -r ./requirements.txt
./scripts/run-v3.3.2.sh /path/to/openspec
```

## Release acceptance

Локальный contract gate:

```text
12/12 pytest PASS
3/3 Node PASS
npm run build:all PASS
```

После этого обязательно повторно без изменений прогнать:

```text
v3.3.1 = 16/16 + build PASS
v3.3   = 30/30 PASS
v3.2 и всю старую regression matrix = PASS
```

И уже на staging:

```powershell
$env:VIBUS_STAGING_URL='https://staging.example.com'
python .\scripts\staging_smoke.py
```

**Gate-файлы не модифицировать. Исправлять только production code.**
