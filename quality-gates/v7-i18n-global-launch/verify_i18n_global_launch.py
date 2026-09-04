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
legal_page = src / 'pages' / 'legalpage.tsx'
web_legal_en = src / 'legal' / 'docs' / 'en'
canonical_legal_en = root / 'docs' / 'legal' / 'en'
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


def object_literal(source: str, export_name: str) -> str:
    """Return one exported object literal without evaluating TypeScript.

    Locale extension modules intentionally remain TypeScript so product copy can
    be reviewed close to the UI work. The release gate must inspect those
    resources without executing application code.
    """
    match = re.search(rf'export\s+const\s+{re.escape(export_name)}\s*=\s*\{{', source)
    if not match:
        raise ValueError(f'missing export const {export_name}')
    start = match.end() - 1
    depth = 0
    quote: str | None = None
    escaped = False
    line_comment = False
    block_comment = False
    i = start
    while i < len(source):
        ch = source[i]
        nxt = source[i + 1] if i + 1 < len(source) else ''
        if line_comment:
            if ch == '\n':
                line_comment = False
            i += 1
            continue
        if block_comment:
            if ch == '*' and nxt == '/':
                block_comment = False
                i += 2
                continue
            i += 1
            continue
        if quote:
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == quote:
                quote = None
            i += 1
            continue
        if ch == '/' and nxt == '/':
            line_comment = True
            i += 2
            continue
        if ch == '/' and nxt == '*':
            block_comment = True
            i += 2
            continue
        if ch in ("'", '"', '`'):
            quote = ch
            i += 1
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return source[start:i + 1]
        i += 1
    raise ValueError(f'unterminated object export {export_name}')


def object_leaf_paths(source: str, export_name: str) -> set[str]:
    """Extract leaf translation paths from our conventional nested locale objects."""
    block = object_literal(source, export_name)[1:-1]
    stack: list[str] = []
    leaves: set[str] = set()
    prop_re = re.compile(r"^(?:(['\"])(.*?)\1|([A-Za-z_$][A-Za-z0-9_$]*))\s*:\s*(.*)$")
    for raw in block.splitlines():
        line = raw.strip()
        if not line or line.startswith('//'):
            continue
        while line.startswith('}'):
            if stack:
                stack.pop()
            line = line[1:].lstrip(' ,')
        if not line:
            continue
        match = prop_re.match(line)
        if not match:
            continue
        key = match.group(2) if match.group(1) else match.group(3)
        value = match.group(4).strip()
        if value.startswith('{'):
            stack.append(key)
        else:
            leaves.add('.'.join([*stack, key]))
    return leaves


# Base JSON remains canonical and must stay exactly symmetric.
base_en = flatten(read_json(locale_dir / 'en.json'))
base_ru = flatten(read_json(locale_dir / 'ru.json'))
if set(base_en) != set(base_ru):
    for key in sorted(set(base_en) - set(base_ru))[:50]:
        errors.append(f'RU base locale missing canonical EN key: {key}')
    for key in sorted(set(base_ru) - set(base_en))[:50]:
        errors.append(f'RU base locale has non-canonical extra key: {key}')

# Shipping copy is layered in config.ts. Validate the effective key sets instead
# of pretending locales/en.json and locales/ru.json are the only resources.
LAYERED_LOCALES = (
    ('i18n/v8.ts', 'v8En', 'v8Ru'),
    ('i18n/editorial.ts', 'editorialEn', 'editorialRu'),
    ('i18n/terminology.ts', 'terminologyEn', 'terminologyRu'),
    ('i18n/engineeringTerms.ts', 'engineeringTermsEn', 'engineeringTermsRu'),
    ('i18n/enterpriseTerms.ts', 'enterpriseTermsEn', 'enterpriseTermsRu'),
)
en_keys = set(base_en)
ru_keys = set(base_ru)
for rel, en_export, ru_export in LAYERED_LOCALES:
    path = src / rel
    if not path.is_file():
        errors.append(f'missing layered locale source: openspec-web/src/{rel}')
        continue
    source = path.read_text(encoding='utf-8')
    try:
        en_block = object_literal(source, en_export)
        en_keys.update(object_leaf_paths(source, en_export))
        ru_keys.update(object_leaf_paths(source, ru_export))
        if re.search(r'[А-Яа-яЁё]', en_block):
            errors.append(f'EN layered locale contains Cyrillic: openspec-web/src/{rel}:{en_export}')
    except ValueError as exc:
        errors.append(f'invalid layered locale source openspec-web/src/{rel}: {exc}')

if en_keys != ru_keys:
    for key in sorted(en_keys - ru_keys)[:50]:
        errors.append(f'RU effective locale missing EN key: {key}')
    for key in sorted(ru_keys - en_keys)[:50]:
        errors.append(f'RU effective locale has key missing from EN: {key}')

# Shipping English base locale must not silently contain Russian user-facing values.
for key, value in base_en.items():
    if isinstance(value, str) and re.search(r'[А-Яа-яЁё]', value):
        errors.append(f'EN locale contains Cyrillic user-facing value: {key}: {value[:120]}')

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

# Every declared extension must actually be composed into both effective locales.
for _rel, en_export, ru_export in LAYERED_LOCALES:
    if en_export not in cfg or ru_export not in cfg:
        errors.append(f'i18n config does not compose layered locale pair: {en_export}/{ru_export}')

const_text = constants.read_text(encoding='utf-8')
if "code: 'zh'" in const_text or "code: 'hi'" in const_text:
    errors.append('widget language switcher exposes incomplete zh/hi locales')
if "code: 'en'" not in const_text or "code: 'ru'" not in const_text:
    errors.append('widget language switcher must expose EN and RU')

if re.search(r'[А-Яа-яЁё]', pricing.read_text(encoding='utf-8')):
    errors.append('pricing utility contains localized UI copy; language and billing market must remain separate')
html = index_html.read_text(encoding='utf-8')
if '<html lang="en">' not in html:
    errors.append('landing HTML must be English-first with <html lang="en">')
if re.search(r'[А-Яа-яЁё]', html):
    errors.append('index.html contains hardcoded Cyrillic')

# Static translation calls must use non-Cyrillic keys and exist in both effective locales.
call_re = re.compile(r"\b(?:t18n|tr|t|i18n\.t)\(\s*['\"]([^'\"]+)['\"]")
for path in src.rglob('*'):
    if path.suffix not in {'.ts', '.tsx'}:
        continue
    for line_no, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        for match in call_re.finditer(line):
            key = match.group(1)
            if re.search(r'[А-Яа-яЁё]', key):
                errors.append(f'Cyrillic translation key in source: {path.relative_to(root)}:{line_no}: {key}')
            if key not in en_keys or key not in ru_keys:
                errors.append(f'unknown static translation key: {path.relative_to(root)}:{line_no}: {key}')

# Cyrillic is allowed in explicit Russian locale implementation data, never in
# arbitrary UI source. This keeps the hardcoded-copy guard while allowing the
# layered locale architecture used by config.ts.
LOCALE_IMPLEMENTATION_FILES = {
    'i18n/v8.ts',
    'i18n/editorial.ts',
    'i18n/terminology.ts',
    'i18n/engineeringTerms.ts',
    'i18n/enterpriseTerms.ts',
    'i18n/russianCopy.ts',
}
ALLOWED_CYRILLIC = {
    'i18n/config.ts': [r"ru:\s*'Русский'"],
    'components/MarkdownRenderer.tsx': [r"rawCallout\.includes\("],
    'components/TicketDetailModal.tsx': [r"\.test\(lower\)"],
    'components/widget/hooks/useWidgetState.ts': [r"col\.label", r"\.replace\(/\[\^a-z", r"\.replace\(/\[\^a-z0-9_"],
    'utils/dodCatalog.ts': [r"legacyTitles:\s*\[", r"pattern:\s*/"],
}
for path in src.rglob('*'):
    if path.suffix not in {'.ts', '.tsx'}:
        continue
    rel = path.relative_to(src).as_posix()
    if rel in LOCALE_IMPLEMENTATION_FILES:
        continue
    for line_no, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        if not re.search(r'[А-Яа-яЁё]', line):
            continue
        patterns = ALLOWED_CYRILLIC.get(rel, [])
        if not any(re.search(pattern, line) for pattern in patterns):
            errors.append(f'user-facing/unapproved Cyrillic source: openspec-web/src/{rel}:{line_no}: {line.strip()[:180]}')

# International legal documents are locale-specific contractual surfaces.
legal_slugs = (
    'offer.md',
    'privacy.md',
    'dpa.md',
    'consent.md',
    'subprocessors.md',
    'retention.md',
    'refunds.md',
    'acceptable-use.md',
    'security.md',
    'cookies.md',
)
for filename in legal_slugs:
    public_path = web_legal_en / filename
    canonical_path = canonical_legal_en / filename
    if not public_path.is_file():
        errors.append(f'missing public EN legal document: {public_path.relative_to(root)}')
        continue
    public_text = public_path.read_text(encoding='utf-8')
    if re.search(r'[А-Яа-яЁё]', public_text):
        errors.append(f'EN legal document contains Cyrillic: {public_path.relative_to(root)}')
    if not canonical_path.is_file():
        errors.append(f'missing canonical EN legal document: {canonical_path.relative_to(root)}')
    elif canonical_path.read_text(encoding='utf-8') != public_text:
        errors.append(f'canonical/public EN legal document drift: {filename}')

legal_text = legal_page.read_text(encoding='utf-8')
for invariant in (
    "normalizeUiLocale(i18n.language)",
    "locale === 'ru' ? RU_DOCS : EN_DOCS",
    "../legal/docs/en/privacy.md?raw",
    "../legal/docs/en/offer.md?raw",
    "../legal/docs/en/dpa.md?raw",
):
    if invariant not in legal_text:
        errors.append(f'legal page missing locale-specific legal invariant: {invariant}')
if 'navigation only and do not replace the legal text' in legal_text:
    errors.append('legal page still represents English legal content as navigation-only')

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
print(f'V7 I18N GLOBAL LAUNCH: PASS (effective EN/RU {len(en_keys)} keys, layered locales and legal documents verified)')
