from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
from pathlib import Path


CRITICAL_PATHS = [
    "openspec-core/Dockerfile",
    "openspec-core/yookassa_service.py",
    "openspec-core/manage_receipts.py",
    "openspec-core/models.py",
    "openspec-core/test_release_gates.py",
    "openspec-core/test_migration_runtime.py",
    "run_release_gate.py",
    "scripts/render_pricing.py",
]


def norm(text: str) -> str:
    return text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")


def sha(text: str) -> str:
    return hashlib.sha256(norm(text).encode("utf-8")).hexdigest()


def tracked(repo: Path) -> set[str]:
    p = subprocess.run(["git", "ls-files"], cwd=repo, capture_output=True, text=True, check=False)
    if p.returncode:
        raise SystemExit(f"git ls-files failed: {p.stderr}")
    return set(p.stdout.splitlines())


def git_head(repo: Path) -> str:
    p = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True, check=False)
    if p.returncode:
        raise SystemExit(f"git rev-parse HEAD failed: {p.stderr}")
    return p.stdout.strip()


def git_dirty(repo: Path) -> bool:
    p = subprocess.run(["git", "status", "--porcelain"], cwd=repo, capture_output=True, text=True, check=False)
    if p.returncode:
        raise SystemExit(f"git status failed: {p.stderr}")
    return bool(p.stdout.strip())


def parse_marked_files(snapshot_text: str) -> dict[str, str]:
    marker = re.compile(r"^--- Файл: (.+?) ---\s*$", re.M)
    matches = list(marker.finditer(snapshot_text))
    out: dict[str, str] = {}
    for i, m in enumerate(matches):
        path = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(snapshot_text)
        block = snapshot_text[start:end].strip("\n")
        lines = block.splitlines()
        if lines and lines[0].lstrip().startswith("```"):
            lines = lines[1:]
        # Remove the final markdown fence only; embedded fences remain intact.
        while lines and not lines[-1].strip():
            lines.pop()
        if lines and lines[-1].strip() in {"```", "````"}:
            lines.pop()
        out[path] = "\n".join(lines)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Prove that a VibeUs review snapshot exactly represents the clean Git release commit.")
    ap.add_argument("--repo", required=True, type=Path)
    ap.add_argument("--snapshot", required=True, type=Path)
    args = ap.parse_args()
    repo = args.repo.resolve()
    snap = args.snapshot.resolve()
    text = snap.read_text(encoding="utf-8-sig", errors="strict")
    files = parse_marked_files(text)
    index = tracked(repo)
    head = git_head(repo)

    errors: list[str] = []
    if git_dirty(repo):
        errors.append("working tree/index is dirty; release review snapshot must be generated from a clean commit")

    # New exporter contract: make the artifact self-identifying instead of relying on a walkthrough claim.
    if f"--- GIT HEAD: {head} ---" not in text:
        errors.append(f"snapshot does not declare exact current commit: --- GIT HEAD: {head} ---")
    if "--- GIT DIRTY: false ---" not in text:
        errors.append("snapshot does not declare a clean tree with: --- GIT DIRTY: false ---")

    for required in CRITICAL_PATHS:
        if required not in index:
            errors.append(f"Git index missing exact required path: {required}")
            continue
        if required not in files:
            errors.append(f"snapshot missing exact marker: --- Файл: {required} ---")
            continue
        repo_text = (repo / required).read_text(encoding="utf-8-sig", errors="strict")
        if sha(repo_text) != sha(files[required]):
            errors.append(
                f"snapshot content mismatch for {required}: repo={sha(repo_text)} snapshot={sha(files[required])}"
            )

    if "openspec-core/dockerfile" in files or "openspec-core/dockerfile" in index:
        errors.append("lowercase openspec-core/dockerfile detected; exact production path is openspec-core/Dockerfile")

    if errors:
        print("REVIEW SNAPSHOT: FAIL")
        for item in errors:
            print(f"- {item}")
        return 1
    print(f"REVIEW SNAPSHOT: PASS ({head})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
