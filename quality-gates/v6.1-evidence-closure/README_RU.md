# VibeUs Quality Gate v6.1 — Evidence Closure

Этот gate закрывает главный разрыв Criteria Contract v2: `[x]` — только claim, а не machine verification.

Гарантии:
- structured criterion хранится в тикете и доезжает Web -> API/DB -> board -> CLI;
- evidence хранится отдельно и инвалидируется при снятии claim или изменении criterion contract;
- Strict/Critical BLOCKER/HIGH не могут auto-review без verified PASS receipt;
- CLI выполняет только allowlisted adapters и никогда не запускает shell-команду из LLM/Markdown;
- backend повторно проверяет auto-review и отвергает его с `criteria_unverified`;
- legacy/Standard workflow остаётся обратно совместимым;
- финальная acceptance остаётся за человеком.

Run:
```bash
python quality-gates/v6.1-evidence-closure/verify_evidence_closure.py .
node --test quality-gates/v6.1-evidence-closure/tests-js/evidence_closure.test.mjs
python quality-gates/v6.1-evidence-closure/scripts/migration_smoke.py .
```
