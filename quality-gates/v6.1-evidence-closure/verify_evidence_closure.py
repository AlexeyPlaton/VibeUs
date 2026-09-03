from __future__ import annotations
import re
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
required = {
    'model': root/'openspec-core/models.py',
    'schema': root/'openspec-core/schemas.py',
    'crud': root/'openspec-core/crud.py',
    'main': root/'openspec-core/main.py',
    'migration': root/'openspec-core/alembic/versions/c5d6e7f8a9b0_criteria_contract_evidence.py',
    'verifier': root/'openspec-cli/criteria-verifier.js',
    'cli': root/'openspec-cli/index.js',
    'tunnel': root/'openspec-cli/tunnel.js',
    'manager': root/'openspec-web/src/components/widget/ui/DoDManager.tsx',
    'modal': root/'openspec-web/src/components/TicketDetailModal.tsx',
    'contract': root/'openspec-web/src/utils/engineeringContract.ts',
}
errors=[]
for name,path in required.items():
    if not path.is_file(): errors.append(f'MISSING {name}: {path.relative_to(root)}')
if errors:
    print('V6.1 EVIDENCE CLOSURE: FAIL', file=sys.stderr); print('\n'.join(errors), file=sys.stderr); raise SystemExit(1)
text={k:p.read_text(encoding='utf-8') for k,p in required.items()}
for field in ('criteria_contract = Column(JSON', 'criteria_evidence = Column(JSON', "quality_mode = Column(String(16)"):
    if field not in text['model']: errors.append(f'model missing {field}')
for field in ('criteria_contract:', 'criteria_evidence:', 'quality_mode:'):
    if field not in text['schema']: errors.append(f'schema missing {field}')
update_block = text['schema'].split('class TicketUpdate', 1)[1].split('class TicketReviewActionRequest', 1)[0]
if 'criteria_evidence:' in update_block: errors.append('TicketUpdate must not accept client-written criteria_evidence')
if 'down_revision: Union[str, None] = "b4c5d6e7f8a9"' not in text['migration']:
    errors.append('migration must be a forward revision from V5 head b4c5d6e7f8a9')
for needle in ('SAFE_VERIFICATION_ADAPTERS', "shell: false", 'canAutoReview', 'criterionNeedsVerification', 'receipt_sha256'):
    if needle not in text['verifier']: errors.append(f'verifier missing {needle}')
if re.search(r'spawn\([^\n]+shell:\s*true', text['verifier']): errors.append('verifier enables shell execution')
for name in ('cli','tunnel'):
    for needle in ("ticket.criteria.evidence", "automation: true", 'canAutoReview(ticket)', 'verifyCriterion(contract'):
        if needle not in text[name]: errors.append(f'{name} missing {needle}')
    legacy = re.search(r'if \(checklistCount > 0 && allChecked[\s\S]{0,600}payload: \{ status: [\'\"]review[\'\"] \}', text[name])
    if legacy: errors.append(f'{name} still has checkbox-only auto-review path')
for needle in ('criteria_unverified', '_criteria_auto_review_ready', '_validated_criteria_receipt', 'digest mismatch', 'manual_verify_ticket_criterion', 'human_review'):
    if needle not in text['main']: errors.append(f'backend missing {needle}')
for needle in ('old_contract', 'new_evidence.pop', 'ticket.criteria_evidence = new_evidence'):
    if needle not in text['crud']: errors.append(f'evidence invalidation missing {needle}')
if 'onAddCriteria' not in text['manager'] or 'verificationAdapter' not in text['manager']:
    errors.append('DoD manager does not persist structured verification adapter metadata')
for needle in ('criteria_contract', 'toPersistedCriterion', 'quality_mode'):
    if needle not in text['modal']: errors.append(f'ticket modal missing {needle}')
for needle in ('criteriaContract', 'criteriaEvidence', 'VERIFIED PASS'):
    if needle not in text['contract']: errors.append(f'execution prompt missing persisted evidence rendering: {needle}')
if errors:
    print('V6.1 EVIDENCE CLOSURE: FAIL', file=sys.stderr)
    for e in errors: print(f'- {e}', file=sys.stderr)
    raise SystemExit(1)
print('V6.1 EVIDENCE CLOSURE: PASS')
