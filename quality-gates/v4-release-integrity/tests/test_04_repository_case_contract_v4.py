from __future__ import annotations

import subprocess
from pathlib import Path

import pytest


@pytest.mark.blocker
def test_git_index_uses_exact_production_dockerfile_case(project_root: Path):
    proc = subprocess.run(
        ["git", "ls-files"], cwd=project_root, capture_output=True, text=True, check=False
    )
    assert proc.returncode == 0, f"git ls-files failed: {proc.stderr}"
    tracked = set(proc.stdout.splitlines())
    assert "openspec-core/Dockerfile" in tracked, (
        "Git index must contain exact case openspec-core/Dockerfile because docker-compose uses Dockerfile."
    )
    assert "openspec-core/dockerfile" not in tracked, (
        "Lowercase openspec-core/dockerfile remains tracked; Windows filesystem checks can hide this Linux deployment bug."
    )


@pytest.mark.blocker
def test_release_gate_and_pricing_renderer_are_real_tracked_root_files(project_root: Path):
    proc = subprocess.run(["git", "ls-files"], cwd=project_root, capture_output=True, text=True, check=False)
    assert proc.returncode == 0, proc.stderr
    tracked = set(proc.stdout.splitlines())
    for required in ("run_release_gate.py", "scripts/render_pricing.py"):
        assert required in tracked, f"Required release artifact is not tracked at exact path: {required}"
        assert (project_root / required).is_file(), f"Tracked release artifact missing from working tree: {required}"
