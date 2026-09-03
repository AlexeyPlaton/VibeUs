param(
    [Parameter(Mandatory=$true)][string]$ProjectRoot,
    [string]$Snapshot = ""
)
$ErrorActionPreference = "Stop"
$GateDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$env:VIBUS_PROJECT_ROOT = (Resolve-Path $ProjectRoot).Path
Push-Location $GateDir
try {
    python verify_integrity.py
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    python -m pytest -q
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($Snapshot) {
        python scripts/verify_review_snapshot.py --repo $env:VIBUS_PROJECT_ROOT --snapshot (Resolve-Path $Snapshot).Path
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
} finally {
    Pop-Location
}
Push-Location $env:VIBUS_PROJECT_ROOT
try {
    if (-not (Test-Path -LiteralPath ".\run_release_gate.py" -PathType Leaf)) { throw "Missing root run_release_gate.py" }
    python .\run_release_gate.py
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "`n[V4 RELEASE INTEGRITY GATE: PASS]"
} finally {
    Pop-Location
}
