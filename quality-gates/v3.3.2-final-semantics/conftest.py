import importlib
import os
import sys
from pathlib import Path
import pytest

@pytest.fixture(scope='session')
def project_root() -> Path:
    raw = os.getenv('VIBUS_PROJECT_ROOT')
    root = Path(raw).resolve() if raw else Path(__file__).resolve().parents[2]
    required = [root/'openspec-core', root/'openspec-web', root/'openspec-cli']
    missing = [str(p) for p in required if not p.exists()]
    if missing:
        pytest.fail('Invalid VIBUS_PROJECT_ROOT; missing: ' + ', '.join(missing))
    return root


def read_text(path: Path) -> str:
    if not path.exists():
        # Windows is case-insensitive, but the gate may be running on Linux against a repo
        # that was authored on Windows. Give a useful diagnostic rather than a raw traceback.
        raise AssertionError(f'Missing expected production file: {path}')
    return path.read_text(encoding='utf-8')


def function_block(src: str, marker: str, next_prefix: str = '\nasync def ') -> str:
    start = src.find(marker)
    if start < 0:
        raise AssertionError(f'Missing function marker: {marker}')
    end = src.find(next_prefix, start + len(marker))
    if end < 0:
        end = len(src)
    return src[start:end]


def class_block(src: str, marker: str, next_prefix: str = '\nclass ') -> str:
    start = src.find(marker)
    if start < 0:
        raise AssertionError(f'Missing class marker: {marker}')
    end = src.find(next_prefix, start + len(marker))
    if end < 0:
        end = len(src)
    return src[start:end]


@pytest.fixture(scope='session')
def core_modules(project_root: Path):
    """Import the user's actual core modules, not copies from the gate."""
    core = project_root / 'openspec-core'
    os.environ.setdefault('ENVIRONMENT', 'test')
    os.environ.setdefault('TESTING', 'true')
    os.environ.setdefault('DATABASE_URL', 'sqlite+aiosqlite:///:memory:')
    os.environ.setdefault('TOKEN_PEPPER', 'qg-v332-token-pepper-0123456789abcdef')
    os.environ.setdefault('FIELD_ENCRYPTION_KEY', 'qg-v332-field-key-0123456789abcdef')
    sys.path.insert(0, str(core))
    mods = {}
    for name in ('models', 'schemas', 'crud'):
        mods[name] = importlib.import_module(name)
    return mods
