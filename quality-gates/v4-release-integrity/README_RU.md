# VibeUs Quality Gate v4 — Release Integrity / Fiscal Ledger

Этот gate создан по snapshot от 2026-09-02 **после** заявленного `RELEASE: PASS` и специально ловит ложную зелень, которую текущие тесты не покрывают.

## Release blockers

1. **BILL-V4-001 / P0 — checkout без durable ledger запрещён.**
   YooKassa confirmation URL нельзя отдавать клиенту, если `Payment` не записался. При ошибке `commit()` требуется `rollback()` + 5xx. То же правило действует в mock-режиме, иначе release tests сами могут быть false-green.
2. **BILL-V4-002 / P1 — `payment.canceled` должен быть подтверждён provider state.**
   Имя входящего webhook-события само по себе не имеет права менять ledger. Положительный контроль сохраняет нормальную отмену при реально `status=canceled` у YooKassa.
3. **FISCAL-V4-001 / P1 — buyer identity является свойством платежа.**
   `buyer_email`, `buyer_is_b2b`, `buyer_inn`, `buyer_name` фиксируются при checkout в `Payment`. Операторский список чеков читает именно snapshot платежа, а не текущий `Workspace`.
4. **FISCAL-V4-002 / P1 — fiscal state machine защищена CHECK constraints в БД.**
   Недопустимы произвольные `tax_mode/fiscal_status`, `receipt_required` до успешной оплаты, KKT + NPD receipt states, `receipt_issued` без URL и timestamp.
5. **SEC-V4-001 / P1 — legacy public widget key fail-closed.**
   Если у старого проекта отсутствует `public_widget_key_digest`, любой случайный заголовок не должен проходить. Нормально сконфигурированный public widget при этом обязан продолжать работать.
6. **REVIEW-V4-001 — review snapshot является доказуемым Git snapshot.**
   Exact-case `openspec-core/Dockerfile`, root `run_release_gate.py`, `scripts/render_pricing.py` должны быть tracked и реально присутствовать в export. Snapshot должен объявлять точный `GIT HEAD` и clean status, а critical file contents сверяются с Git working tree по SHA-256.
7. **REG-V4-001 — нельзя чинить v4 вырезанием старого функционала.**
   Runner после новых тестов обязательно запускает существующий `run_release_gate.py`.

## Важная миграционная политика

Нельзя редактировать уже опубликованные миграции `9bc026dc6e3a`, `f0a1b2c3d4e5`, `e1f2a3b4c5d6`, `f2a3b4c5d6e7`. Gate хранит их normalized SHA-256. Все новые поля/constraints — **только новой forward migration** с `down_revision` на текущий head.

## Запуск

Windows:

```powershell
cd quality-gates\v4-release-integrity
python -m pip install -r requirements.txt
.\scripts\run-v4.ps1 -ProjectRoot C:\path\to\Vibus -Snapshot C:\path\to\vibus_review_snapshot.txt
```

Linux/macOS:

```bash
cd quality-gates/v4-release-integrity
python -m pip install -r requirements.txt
./scripts/run-v4.sh /path/to/Vibus /path/to/vibus_review_snapshot.txt
```

Для промежуточной работы агента snapshot можно не передавать, но финальный release run обязан проверить и snapshot.

## Expected state на переданном snapshot

Gate **должен быть RED** до исправления production-кода. Если агент получает PASS без изменения production-кода, считать это tampering/обходом и проверить `manifest.sha256`.
