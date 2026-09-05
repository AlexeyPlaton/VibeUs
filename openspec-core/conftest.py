"""Pytest-only assembly for private founder/control routers.

The production/customer ``main.app`` intentionally does not expose /api/control.
Founder router regressions are still exercised in this public test suite until the
private control-plane CI fully owns them. Pytest imports this file before test
modules, so the test app gets the private routers without changing production
runtime behavior.
"""
from __future__ import annotations

import os

if os.getenv("ENVIRONMENT") == "test" or os.getenv("TESTING", "").lower() == "true":
    import control_router
    import founder_growth_strategy
    import founder_ops
    import main
    import product_radar

    control_router.ROADMAP = [
        {
            "area": "Security",
            "title": "Platform-admin passkey / MFA",
            "description": "Blocked until VibeUs has a real WebAuthn/passkey enrollment, verification, recovery and revocation lifecycle. A UI toggle is not MFA.",
        },
        {
            "area": "Revenue",
            "title": "Provider-side refund and recurring cancellation adapters",
            "description": "Blocked until the approved production payment provider and its exact refund/subscription/fiscal semantics are verified. Local ledger mutation is never presented as a remote refund.",
        },
    ]

    mounted_paths = {getattr(route, "path", None) for route in main.app.router.routes}
    if "/api/control/me" not in mounted_paths:
        main.app.include_router(control_router.router)
        main.app.include_router(product_radar.router)
        main.app.include_router(founder_ops.router)
        main.app.include_router(founder_ops.runtime_router)
        main.app.include_router(founder_growth_strategy.router)
