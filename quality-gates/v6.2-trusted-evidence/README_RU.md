# V6.2 Trusted Evidence Binding

Закрывает подмену evidence receipt после V6.1.

Инварианты:
- receipt привязан к точному criterion key/id и SHA-256 fingerprint текущего structured contract;
- adapter и target receipt обязаны точно совпадать с contract;
- machine PASS требует `exit_code=0`, `timed_out=false`, `provenance=local_cli`, `verifier=vibus-cli-v6.2`;
- human receipt создаётся только сервером и помечается `provenance=human_review`;
- старые V6.1 receipts без contract binding больше не открывают Strict/Critical Review;
- изменение requirement/pass condition/adapter/target делает старый receipt непригодным;
- server-side Review policy заново валидирует stored receipt, а не доверяет одному флагу `verified`.

Важно: локальный verifier не является криптографически доверенной вычислительной средой против владельца машины, который сознательно подделывает весь клиент. Для такой threat model нужен отдельный hosted/CI trusted runner с server-held signing key. V6.2 закрывает self-certification и substitution/replay в штатном VibeUs workflow и честно маркирует provenance.
