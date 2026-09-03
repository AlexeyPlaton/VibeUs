import os
import re
from pathlib import Path
from conftest import read_text


def _resolve_exact_relative_import(source_file: Path, spec: str):
    spec_clean = spec.split('?')[0]
    base = source_file.parent
    raw = base / spec_clean
    candidates = []
    if raw.suffix:
        candidates.append(raw)
    else:
        for ext in ('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'):
            candidates.append(Path(str(raw) + ext))
        for name in ('index.ts','index.tsx','index.js','index.jsx'):
            candidates.append(raw / name)
    for candidate in candidates:
        # Case-sensitive resolution even on Windows: compare each path component to directory entries.
        try:
            rel = candidate.resolve(strict=False).relative_to(candidate.anchor)
        except Exception:
            rel = candidate
        cur = Path(candidate.anchor) if candidate.is_absolute() else Path('.')
        parts = candidate.parts[1:] if candidate.is_absolute() else candidate.parts
        ok = True
        for part in parts:
            if part in ('.', ''):
                continue
            if part == '..':
                cur = cur.parent
                continue
            if not cur.exists() or not cur.is_dir():
                ok = False; break
            names = {p.name for p in cur.iterdir()}
            if part not in names:
                ok = False; break
            cur = cur / part
        if ok and cur.exists() and cur.is_file():
            return cur
    return None


def test_09_all_relative_ts_imports_match_filesystem_case(project_root: Path):
    web = project_root/'openspec-web'/'src'
    assert web.exists()
    bad = []
    import_re = re.compile(r'(?:from\s+|import\s*\()([\'\"])(\.{1,2}/[^\'\"]+)\1')
    side_effect_re = re.compile(r'import\s+([\'\"])(\.{1,2}/[^\'\"]+)\1')
    for p in list(web.rglob('*.ts')) + list(web.rglob('*.tsx')):
        src = p.read_text(encoding='utf-8')
        specs = [m.group(2) for m in import_re.finditer(src)] + [m.group(2) for m in side_effect_re.finditer(src)]
        for spec in specs:
            # CSS/assets are still checked if they exist in source tree; Vite aliases/packages are skipped because not relative.
            if _resolve_exact_relative_import(p, spec) is None:
                bad.append(f'{p.relative_to(project_root)} -> {spec}')
    assert not bad, 'Relative import casing/path does not match the actual filesystem (Linux build risk):\n' + '\n'.join(sorted(set(bad))[:50])


def test_10_single_use_fingerprint_used_by_all_authenticated_rest(project_root: Path):
    client = read_text(project_root/'openspec-web'/'src'/'components'/'widget'/'api'/'client.ts')
    hook = read_text(project_root/'openspec-web'/'src'/'components'/'widget'/'hooks'/'useWidgetState.ts')
    assert 'X-Device-Fingerprint' in client, 'Typed API client must attach the stable device fingerprint to authenticated REST requests'
    get_headers = client[client.find('function getHeaders'):client.find('function cleanBase')]
    assert ('getOrCreateDeviceId' in get_headers or 'fingerprint' in get_headers), 'getHeaders must derive/reuse the same stable browser fingerprint used by WS auth'
    fetch_start = hook.find('const fetchBoard')
    fetch_end = hook.find('const persistOrResync', fetch_start)
    fetch_block = hook[fetch_start:fetch_end]
    assert 'X-Device-Fingerprint' in fetch_block, 'fetchBoard/resync must send X-Device-Fingerprint or a consumed single-use link fails after WS activation'
    assert ('getOrCreateDeviceId' in fetch_block or 'fingerprint' in fetch_block), 'fetchBoard must reuse the stable device id'


def test_11_client_preview_consumes_server_capabilities(project_root: Path):
    hook = read_text(project_root/'openspec-web'/'src'/'components'/'widget'/'hooks'/'useWidgetState.ts')
    ui = read_text(project_root/'openspec-web'/'src'/'components'/'VibusWidgetUI.tsx')
    auth_idx = hook.find("data.type === 'auth_ok'")
    assert auth_idx >= 0
    auth_block = hook[auth_idx:auth_idx+900]
    assert 'data.capabilities' in auth_block, 'auth_ok capabilities are sent by backend but ignored by frontend'
    assert ('setCapabilities' in auth_block or 'capabilitiesRef' in auth_block), 'Frontend must persist auth capabilities'
    assert re.search(r'canWrite|isReadOnly|canProjectWrite', hook), 'Derive a write/read-only capability state from project:write'
    assert re.search(r'canManageSettings|settings:manage', hook), 'Derive settings permission from settings:manage'
    assert re.search(r'canWrite|isReadOnly|canProjectWrite', ui), 'VibusWidgetUI must consume read-only/write capability state'
    assert re.search(r'canManageSettings|settings:manage', ui), 'Settings UI must be capability-gated, not merely server-rejected after click'


def test_12_identity_creating_mutations_reconcile_authoritative_board(project_root: Path):
    hook = read_text(project_root/'openspec-web'/'src'/'components'/'widget'/'hooks'/'useWidgetState.ts')
    assert ('persistAndReconcile' in hook or 'persistAndResync' in hook), (
        'Add a central helper that awaits identity-creating REST mutations and then authoritative fetchBoard/resync; '
        'WS availability must not be required to replace temporary node/ticket IDs'
    )
    helper_name = 'persistAndReconcile' if 'persistAndReconcile' in hook else 'persistAndResync'
    helper_idx = hook.find(f'const {helper_name}')
    assert helper_idx >= 0
    helper_block = hook[helper_idx:helper_idx+1200]
    assert 'await' in helper_block and 'fetchBoard' in helper_block, 'Reconcile helper must await server success and fetch authoritative board'
    for api in ('createTicket', 'createNode', 'convertDiscussionToTicket', 'convertFeedbackToTicket'):
        # At least one call to each identity-creating API must be routed through the reconciliation helper.
        assert re.search(rf'{helper_name}\s*\(\s*{api}\s*\(', hook), f'{api} must use {helper_name}; fire-and-forget leaves temporary IDs authoritative when WS is down'
