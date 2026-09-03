# Задание AI-агенту — VibeUs v4 Release Integrity

Работай только с production-кодом/новой migration/exporter. Файлы этого gate изменять запрещено.

## Нельзя

- менять/удалять/skip/xfail тесты v4;
- редактировать опубликованные migrations, защищённые SHA;
- ловить исключение `Payment` persistence и возвращать checkout URL;
- решать legacy public-key тест отключением endpoint `/feedback`;
- решать webhook test игнорированием **всех** `payment.canceled`;
- брать buyer identity для старого платежа из текущего `Workspace`;
- создавать CHECK-like проверки только в Python: v4 вставляет invalid rows напрямую SQL в migrated DB;
- переименовывать `Dockerfile` только на диске без исправления **Git index casing**;
- делать snapshot из dirty working tree;
- обходить старые release suites. `run_release_gate.py` должен остаться зелёным.

## Обязательный scope production fix

1. `openspec-core/yookassa_service.py`
   - checkout success существует только после durable `Payment` commit;
   - commit failure => rollback + HTTP 5xx, confirmation URL наружу не возвращать;
   - mock path такой же fail-closed;
   - `payment.canceled` применять только когда аутентифицированный/re-fetched provider object имеет `status == "canceled"`.
2. `Payment` + новая Alembic migration
   - добавить `buyer_email`, `buyer_is_b2b`, `buyer_inn`, `buyer_name`;
   - snapshot при checkout;
   - CHECK constraints для `tax_mode` и fiscal lifecycle;
   - не переписывать историю.
3. `manage_receipts.py`
   - `list` должен показывать immutable buyer snapshot платежа; для B2B — INN/name;
   - не читать эти значения из mutable Workspace как источник истины.
4. Public feedback
   - отсутствие configured digest => fail closed 401/403;
   - корректный configured key по-прежнему работает.
5. Review exporter / Git casing
   - exact tracked `openspec-core/Dockerfile`;
   - export включает critical root files;
   - export пишет `--- GIT HEAD: <sha> ---` и `--- GIT DIRTY: false ---`;
   - snapshot contents должны совпадать с Git files.

## Definition of Done

```text
v4 pytest                 PASS
review snapshot verifier  PASS
existing run_release_gate PASS
[V4 RELEASE INTEGRITY GATE: PASS]
```

В отчёте приложи: `git diff --check`, `git status --short`, `git ls-files openspec-core`, `alembic heads`, новый migration revision, полный вывод v4 runner. Не заявляй PASS по отдельным тестам вместо полного runner.
