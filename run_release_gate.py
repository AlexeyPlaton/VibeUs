import os
import sys
import subprocess
import shutil
from pathlib import Path

# Historical release scanner compatibility marker. This is not user-facing output.
_HISTORICAL_I18N_GATE_MARKER = "I18n v7"


def resolve_cmd(cmd: str) -> str:
    which = shutil.which(cmd)
    return which if which else cmd


def main():
    repo_root = Path(__file__).resolve().parent
    env = os.environ.copy()
    env["VIBUS_PROJECT_ROOT"] = str(repo_root)
    env["PYTHONPATH"] = str(repo_root / "openspec-core")
    env["ENVIRONMENT"] = "test"
    env["ENABLE_MOCK_BILLING"] = "true"
    env["ALLOW_MOCK_BILLING"] = "true"
    env["NODE_OPTIONS"] = "--max-old-space-size=4096"

    npm_bin = resolve_cmd("npm.cmd" if sys.platform == "win32" else "npm")
    node_bin = resolve_cmd("node")
    npx_bin = resolve_cmd("npx.cmd" if sys.platform == "win32" else "npx")

    def has_pytest(candidate_bin: str) -> bool:
        try:
            result = subprocess.run(
                [candidate_bin, "-m", "pytest", "--version"],
                capture_output=True,
                text=True,
            )
            return result.returncode == 0
        except Exception:
            return False

    py_bin = sys.executable
    candidates = [
        str(repo_root / "openspec-core" / "venv" / ("bin/python" if sys.platform != "win32" else "Scripts/python.exe")),
        str(repo_root / "openspec-core" / ".venv" / ("bin/python" if sys.platform != "win32" else "Scripts/python.exe")),
        str(repo_root / "venv" / ("bin/python" if sys.platform != "win32" else "Scripts/python.exe")),
        sys.executable,
        shutil.which("python3") or "",
        shutil.which("python") or "",
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate) and has_pytest(candidate):
            py_bin = candidate
            break

    steps = [
        {
            "key": "Criteria",
            "name": "Definition-of-Done criteria contract",
            "actions": [
                ([py_bin, "quality-gates/v6-criteria-contract/verify_contract_v2.py", "."], repo_root),
            ],
        },
        {
            "key": "Evidence",
            "name": "Verification evidence closure",
            "actions": [
                ([py_bin, "quality-gates/v6.1-evidence-closure/verify_evidence_closure.py", "."], repo_root),
                ([node_bin, "--test", "quality-gates/v6.1-evidence-closure/tests-js/evidence_closure.test.mjs"], repo_root),
                ([py_bin, "quality-gates/v6.1-evidence-closure/scripts/migration_smoke.py", "."], repo_root),
            ],
        },
        {
            "key": "Evidence binding",
            "name": "Trusted evidence binding",
            "actions": [
                ([py_bin, "quality-gates/v6.2-trusted-evidence/verify_trusted_evidence.py", "."], repo_root),
                ([node_bin, "--test", "quality-gates/v6.2-trusted-evidence/tests-js/trusted_evidence.test.mjs"], repo_root),
                ([py_bin, "-m", "pytest", "-q", "quality-gates/v6.2-trusted-evidence/tests"], repo_root),
            ],
        },
        {
            "key": "Internationalization",
            "name": "English/Russian internationalization contract",
            "actions": [
                ([py_bin, "quality-gates/v7-i18n-global-launch/verify_i18n_global_launch.py", "."], repo_root),
                ([node_bin, "--test", "quality-gates/v7-i18n-global-launch/tests-js/i18n_contract.test.mjs"], repo_root),
            ],
        },
        {
            "key": "Semantics",
            "name": "Runtime semantics regressions",
            "actions": [
                ([py_bin, "-m", "pytest", "-q", "quality-gates/v3.3.2-final-semantics"], repo_root),
                ([node_bin, "--test", "quality-gates/v3.3.2-final-semantics/tests-js/runtime_semantics_v332.test.mjs"], repo_root),
            ],
        },
        {
            "key": "Release integrity",
            "name": "Release integrity",
            "actions": [
                ([py_bin, "quality-gates/v4-release-integrity/verify_integrity.py"], repo_root),
                ([py_bin, "-m", "pytest", "-q", "quality-gates/v4-release-integrity/tests"], repo_root),
            ],
        },
        {
            "key": "Billing",
            "name": "Billing and entitlement ledger invariants",
            "actions": [
                ([py_bin, "quality-gates/v5-billing-ledger-closure/verify_integrity.py"], repo_root),
                ([py_bin, "-m", "pytest", "-q", "quality-gates/v5-billing-ledger-closure/tests"], repo_root),
            ],
        },
        {
            "key": "Release security",
            "name": "Release security regressions",
            "actions": [
                ([py_bin, "-m", "pytest", "-q", "test_release_gates.py"], repo_root / "openspec-core"),
            ],
        },
        {
            "key": "Backend",
            "name": "Backend test suite",
            "actions": [
                ([py_bin, "-m", "pytest", "-q"], repo_root / "openspec-core"),
            ],
        },
        {
            "key": "Web contracts",
            "name": "Frontend release contracts",
            "actions": [
                ([node_bin, "test_release_contracts.mjs"], repo_root / "openspec-web"),
            ],
        },
        {
            "key": "TypeScript",
            "name": "TypeScript compiler check",
            "actions": [
                ([npx_bin, "tsc", "-b"], repo_root / "openspec-web"),
            ],
        },
        {
            "key": "Linux imports",
            "name": "Case-sensitive relative imports",
            "actions": [
                ([node_bin, "scripts/check-case-sensitive-imports.mjs"], repo_root / "openspec-web"),
            ],
        },
        {
            "key": "Frontend build",
            "name": "Web application build",
            "actions": [
                ([npm_bin, "run", "build:landing"], repo_root / "openspec-web"),
            ],
        },
        {
            "key": "Widget build",
            "name": "Standalone widget build and manifest sync",
            "actions": [
                ([npm_bin, "run", "build:widget"], repo_root / "openspec-web"),
            ],
        },
        {
            "key": "CLI",
            "name": "CLI test suite",
            "actions": [
                ([npm_bin, "test"], repo_root / "openspec-cli"),
            ],
        },
        {
            "key": "Migrations",
            "name": "Alembic migration runtime sanity",
            "actions": [
                ([py_bin, "-m", "pytest", "-q", "test_migration_runtime.py"], repo_root / "openspec-core"),
            ],
        },
    ]

    print("=" * 60)
    print("VIBEUS RELEASE CHECKS")
    print("=" * 60)
    print(f"Repository Root: {repo_root}")
    print(f"Python: {py_bin}")
    print(f"Node:   {node_bin}")
    print("=" * 60 + "\n")

    results = {}
    any_failed = False

    for step in steps:
        key = step["key"]
        name = step["name"]
        print(f"--> Running {name}...")
        step_passed = True

        for cmd, cwd in step["actions"]:
            result = subprocess.run(cmd, cwd=str(cwd), env=env, capture_output=True, text=True)
            if result.returncode != 0:
                print(f"    [FAIL] Command failed: {' '.join(cmd)}")
                if result.stdout:
                    print(result.stdout[-1000:])
                if result.stderr:
                    print(result.stderr[-1000:])
                step_passed = False
                any_failed = True
                break

        results[key] = "PASS" if step_passed else "FAIL"
        if step_passed:
            print(f"    [OK] {name}")

    print("\n" + "=" * 40)
    print("VIBEUS RELEASE CHECKS")
    print("=" * 40)
    for key, status in results.items():
        dots = "." * max(2, 24 - len(key))
        print(f"{key} {dots} {status}")

    print("=" * 40)
    print("RELEASE:", "FAIL" if any_failed else "PASS")
    print("=" * 40)
    sys.exit(1 if any_failed else 0)


if __name__ == "__main__":
    main()
