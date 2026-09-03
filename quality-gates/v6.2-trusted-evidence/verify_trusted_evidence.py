from __future__ import annotations
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
required = {
    'core': root / 'openspec-core' / 'criteria_evidence.py',
    'main': root / 'openspec-core' / 'main.py',
    'verifier': root / 'openspec-cli' / 'criteria-verifier.js',
    'cli': root / 'openspec-cli' / 'index.js',
    'tunnel': root / 'openspec-cli' / 'tunnel.js',
    'contract': root / 'openspec-web' / 'src' / 'utils' / 'engineeringContract.ts',
    'js_tests': root / 'quality-gates' / 'v6.2-trusted-evidence' / 'tests-js' / 'trusted_evidence.test.mjs',
    'py_tests': root / 'quality-gates' / 'v6.2-trusted-evidence' / 'tests' / 'test_backend_binding_v62.py',
}
errors=[]
for name,path in required.items():
    if not path.is_file(): errors.append(f'MISSING {name}: {path.relative_to(root)}')
if not errors:
    text={k:p.read_text(encoding='utf-8') for k,p in required.items()}
    for needle in ('criteria_contract_fingerprint', 'receipt_matches_contract', 'criterion_key', 'contract_sha256', 'provenance', 'exit_code'):
        if needle not in text['core']: errors.append(f'core binding missing {needle}')
    for needle in ('contractFingerprint', 'receiptMatchesContract', "provenance: 'local_cli'", "verifier: LOCAL_VERIFIER_ID", 'exit_code'):
        if needle not in text['verifier']: errors.append(f'CLI binding missing {needle}')
    for name in ('cli','tunnel'):
        if 'criterionKey: key' not in text[name]: errors.append(f'{name} does not bind verification to criterion key')
    if 'validated_machine_receipt(raw_payload, contract)' not in text['main']:
        errors.append('backend does not validate receipt against current contract before persistence')
    if 'criteria_contract_fingerprint(key, contract)' not in text['main']:
        errors.append('human evidence is not bound to current contract fingerprint')
    v6 = (root / 'quality-gates' / 'v6-criteria-contract' / 'verify_contract_v2.py').read_text(encoding='utf-8')
    v61 = (root / 'quality-gates' / 'v6.1-evidence-closure' / 'verify_evidence_closure.py').read_text(encoding='utf-8')
    for canonical in ('dodCatalog.ts', 'aiDoDMatcher.ts', 'engineeringContract.ts', 'useWidgetState.ts', 'DoDManager.tsx'):
        if canonical not in v6: errors.append(f'V6 gate missing canonical case path: {canonical}')
    for canonical in ('DoDManager.tsx', 'TicketDetailModal.tsx', 'engineeringContract.ts'):
        if canonical not in v61: errors.append(f'V6.1 gate missing canonical case path: {canonical}')
    for needle in ('contract fingerprints', 'ticket.criteria.evidence', 'evidence must come from the VibeUs verifier'):
        if needle not in text['contract']: errors.append(f'execution contract missing anti-forgery rule: {needle}')
    for attack in ('substituted adapter', 'substituted target', 'wrong criterion id', 'stale receipt'):
        if attack not in text['js_tests'].lower(): errors.append(f'JS adversarial suite missing {attack}')
if errors:
    print('V6.2 TRUSTED EVIDENCE BINDING: FAIL', file=sys.stderr)
    for e in errors: print(f'- {e}', file=sys.stderr)
    raise SystemExit(1)
print('V6.2 TRUSTED EVIDENCE BINDING: PASS')
