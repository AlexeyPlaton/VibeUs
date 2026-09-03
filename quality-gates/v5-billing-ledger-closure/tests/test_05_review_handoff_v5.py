from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.blocker
@pytest.mark.review
def test_review_delivery_verifier_is_present(project_root: Path):
    script = project_root / "quality-gates" / "v5-billing-ledger-closure" / "scripts" / "verify_delivered_snapshot.py"
    assert script.is_file()
    proc = subprocess.run([sys.executable, str(script), "--help"], capture_output=True, text=True, check=False)
    assert proc.returncode == 0, proc.stderr
    assert "SHA" in proc.stdout.upper() or "snapshot" in proc.stdout.lower()
