from __future__ import annotations

import re
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
files = {
    'catalog': root / 'openspec-web/src/utils/dodCatalog.ts',
    'matcher': root / 'openspec-web/src/utils/aiDoDMatcher.ts',
    'contract': root / 'openspec-web/src/utils/engineeringContract.ts',
    'state': root / 'openspec-web/src/components/widget/hooks/useWidgetState.ts',
    'manager': root / 'openspec-web/src/components/widget/ui/DoDManager.tsx',
    'cli': root / 'openspec-cli/index.js',
    'tunnel': root / 'openspec-cli/tunnel.js',
}
errors: list[str] = []
for name, path in files.items():
    if not path.exists():
        errors.append(f'MISSING {name}: {path.relative_to(root)}')

if errors:
    print('\n'.join(errors), file=sys.stderr)
    raise SystemExit(1)

catalog = files['catalog'].read_text(encoding='utf-8')
matcher = files['matcher'].read_text(encoding='utf-8')
contract = files['contract'].read_text(encoding='utf-8')
state = files['state'].read_text(encoding='utf-8')
manager = files['manager'].read_text(encoding='utf-8')
cli = files['cli'].read_text(encoding='utf-8')
tunnel = files['tunnel'].read_text(encoding='utf-8')

required_fields = ['severity:', 'requirement:', 'why:', 'applicability:', 'verification:', 'forbiddenShortcuts', 'minQuality:']
for field in required_fields:
    if field not in catalog:
        errors.append(f'CATALOG missing contract field: {field}')

ids = set(re.findall(r"\bid:\s*['\"]([A-Za-z0-9_:-]+)['\"]", catalog))
if len(ids) < 55:
    errors.append(f'CATALOG too small: expected >=55 IDs, got {len(ids)}')

required_ids = {
    'BASE_REGRESSION_TEST', 'SEC_CROSS_TENANT', 'API_MUTATION_IDEMPOTENCY',
    'DB_CONSTRAINT_CRITICAL_INVARIANT', 'MIGRATION_PREVIOUS_TO_HEAD',
    'CONCURRENCY_DUPLICATE_REQUEST', 'INTEGRATION_MALFORMED_2XX',
    'INTEGRATION_WEBHOOK_AUTHENTICITY', 'BILLING_DURABLE_LEDGER',
    'BILLING_REFUND_LEDGER', 'PRIVACY_DATA_MINIMIZATION', 'JOB_RETRY_IDEMPOTENT',
    'FILES_PATH_TRAVERSAL', 'REALTIME_AUTH_FIRST_FRAME', 'DEPLOY_BUILD_CLEAN',
    'preset_bug_fix_regression', 'preset_api_endpoint', 'preset_auth_security',
    'preset_database', 'preset_migration', 'preset_concurrency', 'preset_external_integration',
    'preset_billing_transaction', 'preset_ui_component', 'preset_privacy',
    'preset_background_job', 'preset_files_upload', 'preset_realtime', 'preset_deployment',
}
missing = sorted(required_ids - ids)
if missing:
    errors.append(f'CATALOG missing required IDs: {missing}')

for needle in [
    'Principal Software Engineer, Security Reviewer, and Senior QA Automation Architect',
    'Every bug fix requires a regression test',
    'malformed 2xx', 'previous-production->head', 'forbidden_shortcuts', 'positive_control',
    "response_format: { type: 'json_object' }",
]:
    if needle not in matcher:
        errors.append(f'AI matcher missing: {needle}')
if 'Ты — Senior QA Automation' in matcher:
    errors.append('AI matcher still contains the old Russian system prompt')

for needle in [
    'VibeUs Engineering Execution Contract v2',
    'Never mark a criterion complete before its required verification',
    'Do not claim production readiness from a walkthrough alone',
    'CRITERION: <id/title>',
]:
    if needle not in contract:
        errors.append(f'Execution contract missing: {needle}')
if 'buildTicketExecutionPrompt' not in state:
    errors.append('Copy Prompt path does not use buildTicketExecutionPrompt')
if 'saveCustomCheck({' not in manager or 'requiredArtifacts: item.requiredArtifacts' not in manager:
    errors.append('AI-generated structured criteria are not persisted into the local custom catalog before checklist insertion')

for name, text in [('CLI', cli), ('Live Preview tunnel', tunnel)]:
    for needle in [
        'VibeUs Engineering Execution Contract v2',
        'Never mark [x] before the required verification actually ran and passed',
        'malformed 2xx', 'previous-production->head', 'Never invent command results',
    ]:
        if needle not in text:
            errors.append(f'{name} missing execution rule: {needle}')

if errors:
    print('V6 CRITERIA CONTRACT: FAIL', file=sys.stderr)
    for error in errors:
        print(f'- {error}', file=sys.stderr)
    raise SystemExit(1)

print(f'V6 CRITERIA CONTRACT: PASS ({len(ids)} catalog/preset IDs)')
