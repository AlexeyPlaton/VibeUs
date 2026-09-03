from __future__ import annotations

import asyncio
import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio


def _resolve_project_root() -> Path:
    raw = os.environ.get("VIBUS_PROJECT_ROOT")
    candidates = []
    if raw:
        candidates.append(Path(raw))
    here = Path(__file__).resolve()
    # installed as <repo>/quality-gates/v4-release-integrity/conftest.py
    candidates.extend([here.parents[2], here.parents[1].parent, Path.cwd()])
    for candidate in candidates:
        candidate = candidate.expanduser().resolve()
        if (candidate / "openspec-core").is_dir() and (candidate / "openspec-web").is_dir():
            return candidate
    pytest.fail("VIBUS project root not found. Set VIBUS_PROJECT_ROOT to the repository root.")


@pytest.fixture(scope="session")
def project_root() -> Path:
    return _resolve_project_root()


@pytest.fixture(scope="session")
def core_dir(project_root: Path) -> Path:
    return project_root / "openspec-core"


def _purge_core_modules() -> None:
    names = {
        "database", "models", "schemas", "security", "settings", "crud", "auth", "main",
        "stripe_service", "yookassa_service", "manage_receipts", "telegram_service",
        "github_service", "tunnel", "pricing", "entitlements", "error_bridge",
    }
    for name in list(sys.modules):
        if name in names:
            sys.modules.pop(name, None)


@pytest.fixture(scope="session")
def service_modules(core_dir: Path):
    os.environ.setdefault("ENVIRONMENT", "test")
    os.environ.setdefault("TESTING", "true")
    os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    os.environ.setdefault("TOKEN_PEPPER", "qgv4-token-pepper-0123456789abcdef0123456789")
    os.environ.setdefault("FIELD_ENCRYPTION_KEY", "qgv4-field-key-0123456789abcdef0123456789")
    os.environ.setdefault("ENABLE_MOCK_BILLING", "true")
    if str(core_dir) not in sys.path:
        sys.path.insert(0, str(core_dir))
    # Do not purge here: runtime fixture may share the same ORM classes.
    models = importlib.import_module("models")
    yookassa_service = importlib.import_module("yookassa_service")
    return SimpleNamespace(models=models, yookassa_service=yookassa_service)


@pytest.fixture(scope="session")
def receipt_module(core_dir: Path):
    if str(core_dir) not in sys.path:
        sys.path.insert(0, str(core_dir))
    return importlib.import_module("manage_receipts")


@pytest.fixture(scope="session")
def backend_runtime(core_dir: Path, tmp_path_factory):
    db_file = tmp_path_factory.mktemp("qgv4") / "runtime.sqlite"
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_file.as_posix()}"
    os.environ["ENVIRONMENT"] = "test"
    os.environ["TESTING"] = "true"
    os.environ["TOKEN_PEPPER"] = "qgv4-runtime-pepper-0123456789abcdef0123456789"
    os.environ["FIELD_ENCRYPTION_KEY"] = "qgv4-runtime-field-0123456789abcdef0123456789"
    os.environ["ENABLE_MOCK_BILLING"] = "true"
    os.environ["ALLOW_MOCK_BILLING"] = "true"
    os.environ["ENABLE_DEMO_SEED"] = "false"

    _purge_core_modules()
    if str(core_dir) not in sys.path:
        sys.path.insert(0, str(core_dir))
    try:
        database = importlib.import_module("database")
        models = importlib.import_module("models")
        security = importlib.import_module("security")
        main = importlib.import_module("main")
    except Exception as exc:
        pytest.fail(
            "Could not import openspec-core. Install openspec-core runtime dependencies first. "
            f"Original error: {type(exc).__name__}: {exc}"
        )
    return SimpleNamespace(database=database, models=models, security=security, main=main, app=main.app)


@pytest.fixture
def fresh_backend(backend_runtime):
    rt = backend_runtime

    async def reset():
        async with rt.database.engine.begin() as conn:
            await conn.run_sync(rt.models.Base.metadata.drop_all)
            await conn.run_sync(rt.models.Base.metadata.create_all)

    asyncio.run(reset())
    yield rt
    rt.app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def api_client(fresh_backend):
    from httpx import ASGITransport, AsyncClient
    async with AsyncClient(transport=ASGITransport(app=fresh_backend.app), base_url="http://qgv4.local") as client:
        yield client
