from __future__ import annotations

import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
src = root / 'openspec-web' / 'src'
locale_dir = src / 'i18n' / 'locales'
config = src / 'i18n' / 'config.ts'
constants = src / 'components' / 'widget' / 'constants.ts'
pricing = src / 'utils' / 'pricing.ts'
index_html = root / 'openspec-web' / 'index.html'
errors: list[str] = []


def flatten(value: dict, prefix: str = '') -> dict[str, object]:
    out: dict[str, object] = {}
    for key, item in value.items():
        name = f'{prefix}.{key}' if prefix else key
        if isinstance(item, dict):
            out.update(flatten(item, name))
        else:
            out[name] = item
    return out


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception as exc:
        errors.append(f'invalid locale JSON {path.relative_to(root)}: {exc}')
        return {}


en = flatten(read_json(locale_dir / 'en.json'))
ru = flatten(read_json(locale_dir / 'ru.json'))
if set(en) != set(ru):
    for key in sorted(set(en) - set(ru))[:50]:
        errors.append(f'RU locale missing canonical EN key: {key}')
    for key in sorted(set(ru) - set(en))[:50]:
        errors.append(f'RU locale has non-canonical extra key: {key}')

cfg = config.read_text(encoding='utf-8')
for needle in (
    "SUPPORTED_UI_LOCALES = ['en', 'ru']",
    "fallbackLng: 'en'",
    "return 'en';",
    "document.documentElement.lang",
):
    if needle not in cfg:
        errors.append(f'i18n config missing invariant: {needle}')
for forbidden in (
    "import zh from './locales/zh.json'",
    "import hi from './locales/hi.json'",
    "fallbackLng: 'ru'",
):
    if forbidden in cfg:
        errors.append(f'i18n config exposes incomplete/incorrect locale behavior: {forbidden}')

const_text = constants.read_text(encoding='utf-8')
if "code: 'zh'" in const_text or "code: 'hi'" in const_text:
    errors.append('widget language switcher exposes incomplete zh/hi locales')
if "code: 'en'" not in const_text or "code: 'ru'" not in const_text:
    errors.append('widget language switcher must expose EN and RU')

if 'Не удалось' in pricing.read_text(encoding='utf-8') or re.search(r'[А-Яа-яЁё]', pricing.read_text(encoding='utf-8')):
    errors.append('pricing utility contains localized UI copy; language and billing market must remain separate')
html = index_html.read_text(encoding='utf-8')
if '<html lang="en">' not in html:
    errors.append('landing HTML must be English-first with <html lang="en">')
if re.search(r'[А-Яа-яЁё]', html):
    errors.append('index.html contains hardcoded Cyrillic')

# Static translation calls must use non-Cyrillic keys and exist in both shipping locales.
call_re = re.compile(r"\b(?:t18n|tr|t|i18n\.t)\(\s*['\"]([^'\"]+)['\"]")
for path in src.rglob('*'):
    if path.suffix not in {'.ts', '.tsx'}:
        continue
    for line_no, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        for match in call_re.finditer(line):
            key = match.group(1)
            if re.search(r'[А-Яа-яЁё]', key):
                errors.append(f'Cyrillic translation key in source: {path.relative_to(root)}:{line_no}: {key}')
            if key not in en or key not in ru:
                errors.append(f'unknown static translation key: {path.relative_to(root)}:{line_no}: {key}')

# Cyrillic is allowed only as compatibility/parser DATA, never as user-facing source copy.
ALLOWED_CYRILLIC = {
    'components/MarkdownRenderer.tsx': [r"rawCallout\.includes\("],
    'components/TicketDetailModal.tsx': [r"\.test\(lower\)"],
    'components/widget/hooks/useWidgetState.ts': [r"col\.label", r"\.replace\(/\[\^a-z", r"\.replace\(/\[\^a-z0-9_"],
    'utils/dodCatalog.ts': [r"legacyTitles:\s*\[", r"pattern:\s*/"],
}
for path in src.rglob('*'):
    if path.suffix not in {'.ts', '.tsx'}:
        continue
    rel = path.relative_to(src).as_posix()
    for line_no, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        if not re.search(r'[А-Яа-яЁё]', line):
            continue
        patterns = ALLOWED_CYRILLIC.get(rel, [])
        if not any(re.search(pattern, line) for pattern in patterns):
            errors.append(f'user-facing/unapproved Cyrillic source: openspec-web/src/{rel}:{line_no}: {line.strip()[:180]}')

# V7 must be part of both official release orchestration paths.
runner = (root / 'run_release_gate.py').read_text(encoding='utf-8')
if 'v7-i18n-global-launch' not in runner or 'I18n v7' not in runner:
    errors.append('official run_release_gate.py does not execute V7')
all_runner_path = root / 'scripts' / 'run_all_quality_gates.py'
if all_runner_path.is_file():
    all_runner = all_runner_path.read_text(encoding='utf-8')
    if 'v7-i18n-global-launch' not in all_runner:
        errors.append('scripts/run_all_quality_gates.py does not execute V7')
for workflow_rel in ('.github/workflows/release-gate.yml', '.github/workflows/deploy.yml'):
    workflow = root / workflow_rel
    if workflow.is_file():
        workflow_text = workflow.read_text(encoding='utf-8')
        if 'run_release_gate.py' not in workflow_text and 'v7-i18n-global-launch' not in workflow_text:
            errors.append(f'{workflow_rel} does not invoke the official runner or V7 explicitly')

# Global-launch surfaces are expected to use V7 localization explicitly.
for rel in (
    'pages/LandingPage.tsx',
    'pages/CreateProjectPage.tsx',
    'pages/DashboardPage.tsx',
    'pages/legalpage.tsx',
    'components/RuntimeErrorsModal.tsx',
    'components/OnboardingGuideModal.tsx',
    'components/widget/ui/SettingsPanel.tsx',
    'components/widget/ui/DoDManager.tsx',
):
    text = (src / rel).read_text(encoding='utf-8')
    if 'v7.' not in text:
        errors.append(f'global-launch UI surface is not wired to V7 i18n keys: {rel}')

if errors:
    print('V7 I18N GLOBAL LAUNCH: FAIL', file=sys.stderr)
    for item in errors:
        print(f'- {item}', file=sys.stderr)
    raise SystemExit(1)
print(f'V7 I18N GLOBAL LAUNCH: PASS (EN/RU {len(en)} keys, approved compatibility Cyrillic only)')
