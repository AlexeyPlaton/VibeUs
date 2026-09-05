from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_public_runtime_does_not_mount_founder_control_plane():
    main_source = (ROOT / "openspec-core" / "main.py").read_text(encoding="utf-8")
    app_source = (ROOT / "openspec-web" / "src" / "App.tsx").read_text(encoding="utf-8")

    assert "app.include_router(control_router.router)" not in main_source
    assert "app.include_router(product_radar.router)" not in main_source
    assert "app.include_router(founder_ops.router)" not in main_source
    assert "app.include_router(founder_growth_strategy.router)" not in main_source

    assert 'path="/control"' not in app_source
    assert 'path="/control/' not in app_source
    assert "FounderControlShell" not in app_source


def test_public_nginx_fails_closed_for_control_paths():
    nginx = (ROOT / "nginx.prod.conf").read_text(encoding="utf-8")
    assert "location ^~ /api/control" in nginx
    assert "location ^~ /control" in nginx
    # Both private namespaces must be denied before the generic public API/SPA.
    assert nginx.index("location ^~ /api/control") < nginx.index("location /api/")
    assert nginx.index("location ^~ /control") < nginx.index("location / {")


def test_founder_routers_are_mounted_only_by_pytest_assembly_in_public_repo():
    conftest = (ROOT / "openspec-core" / "conftest.py").read_text(encoding="utf-8")
    assert 'os.getenv("ENVIRONMENT") == "test"' in conftest
    assert 'os.getenv("TESTING", "").lower() == "true"' in conftest
    assert "main.app.include_router(control_router.router)" in conftest
    assert "private founder/control routers" in conftest.lower()
