import os
import sys
import subprocess
import shutil
import hashlib
import json
from pathlib import Path

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
            r = subprocess.run([candidate_bin, "-m", "pytest", "--version"], capture_output=True, text=True)
            return r.returncode == 0
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
    for c in candidates:
        if c and os.path.exists(c) and has_pytest(c):
            py_bin = c
            break

    steps = [
        {
            "key": "Criteria v6",
            "name": "Criteria Contract v2 Source Gate",
            "actions": [
                ([py_bin, "quality-gates/v6-criteria-contract/verify_contract_v2.py", "."], repo_root),
            ]
        },
        {
            "key": "Evidence v6.1",
            "name": "Criteria Evidence Closure Gate",
            "actions": [
                ([py_bin, "quality-gates/v6.1-evidence-closure/verify_evidence_closure.py", "."], repo_root),
                ([node_bin, "--test", "quality-gates/v6.1-evidence-closure/tests-js/evidence_closure.test.mjs"], repo_root),
                ([py_bin, "quality-gates/v6.1-evidence-closure/scripts/migration_smoke.py", "."], repo_root),
            ]
        },
        {
            "key": "Trusted evidence v6.2",
            "name": "Criteria Trusted Evidence Binding Gate",
            "actions": [
                ([py_bin, "quality-gates/v6.2-trusted-evidence/verify_trusted_evidence.py", "."], repo_root),
                ([node_bin, "--test", "quality-gates/v6.2-trusted-evidence/tests-js/trusted_evidence.test.mjs"], repo_root),
                ([py_bin, "-m", "pytest", "-q", "quality-gates/v6.2-trusted-evidence/tests"], repo_root),
            ]
        },
        {
            "key": "I18n v7",
            "name": "Internationalization & Global Launch Closure",
            "actions": [
                ([py_bin, "quality-gates/v7-i18n-global-launch/verify_i18n_global_launch.py", "."], repo_root),
                ([node_bin, "--test", "quality-gates/v7-i18n-global-launch/tests-js/i18n_contract.test.mjs"], repo_root),
            ]
        },
        {
            "key": "Final semantics",
            "name": "Quality Gate v3.3.2 (Final Semantics)",
            "actions": [
                ([py_bin, "-m", "pytest", "-q", "quality-gates/v3.3.2-final-semantics"], repo_root),
                ([node_bin, "--test", "quality-gates/v3.3.2-final-semantics/tests-js/runtime_semantics_v332.test.mjs"], repo_root),
            ]
        },
        {
            "key": "Release integrity v4",
            "name": "Quality Gate v4 (Release Integrity)",
            "actions": [
                ([py_bin, "quality-gates/v4-release-integrity/verify_integrity.py"], repo_root),
                ([py_bin, "-m", "pytest", "-q", "quality-gates/v4-release-integrity/tests"], repo_root),
            ]
        },
        {
            "key": "Billing ledger v5",
            "name": "Quality Gate v5 (Billing Ledger Closure)",
            "actions": [
                ([py_bin, "quality-gates/v5-billing-ledger-closure/verify_integrity.py"], repo_root),
                ([py_bin, "-m", "pytest", "-q", "quality-gates/v5-billing-ledger-closure/tests"], repo_root),
            ]
        },
        {
            "key": "Release security",
            "name": "Release Gates (test_release_gates.py)",
            "actions": [
                ([py_bin, "-m", "pytest", "-q", "test_release_gates.py"], repo_root / "openspec-core"),
            ]
        },
        {
            "key": "Backend",
            "name": "Full Backend Test Suite (openspec-core)",
            "actions": [
                ([py_bin, "-m", "pytest", "-q"], repo_root / "openspec-core"),
            ]
        },
        {
            "key": "Web contracts",
            "name": "Frontend Release Contracts",
            "actions": [
                ([node_bin, "test_release_contracts.mjs"], repo_root / "openspec-web"),
            ]
        },
        {
            "key": "TypeScript",
            "name": "TypeScript Strict Compiler Check",
            "actions": [
                ([npx_bin, "tsc", "-b"], repo_root / "openspec-web"),
            ]
        },
        {
            "key": "Linux imports",
            "name": "Case-Sensitive Relative Imports Check",
            "actions": [
                ([node_bin, "scripts/check-case-sensitive-imports.mjs"], repo_root / "openspec-web"),
            ]
        },
        {
            "key": "Frontend build",
            "name": "Vite Web Application Build",
            "actions": [
                ([npm_bin, "run", "build:landing"], repo_root / "openspec-web"),
            ]
        },
        {
            "key": "Widget build",
            "name": "Standalone Widget Build & Manifest Sync",
            "actions": [
                ([npm_bin, "run", "build:widget"], repo_root / "openspec-web"),
            ]
        },
        {
            "key": "CLI",
            "name": "CLI Suite (openspec-cli)",
            "actions": [
                ([npm_bin, "test"], repo_root / "openspec-cli"),
            ]
        },
        {
            "key": "Migrations",
            "name": "Alembic Single-Head & Migration Runtime Sanity",
            "actions": [
                ([py_bin, "-m", "pytest", "-q", "test_migration_runtime.py"], repo_root / "openspec-core"),
            ]
        },
    ]

    print("=" * 60)
    print("VIBEUS OFFICIAL RELEASE GATE RUNNER")
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
            res = subprocess.run(cmd, cwd=str(cwd), env=env, capture_output=True, text=True)
            if res.returncode != 0:
                print(f"    [FAIL] Command failed: {' '.join(cmd)}")
                if res.stdout:
                    print(res.stdout[-1000:])
                if res.stderr:
                    print(res.stderr[-1000:])
                step_passed = False
                any_failed = True
                break

        results[key] = "PASS" if step_passed else "FAIL"
        if step_passed:
            print(f"    [OK] {name}")

    print("\n" + "=" * 40)
    print("VIBEUS RELEASE GATE")
    print("=" * 40)
    for key, status in results.items():
        dots = "." * (24 - len(key))
        print(f"{key} {dots} {status}")

    print("=" * 40)
    if any_failed:
        print("RELEASE: FAIL")
        print("=" * 40)
        sys.exit(1)
    else:
        print("RELEASE: PASS")
        print("=" * 40)
        sys.exit(0)

if __name__ == "__main__":
    main()
