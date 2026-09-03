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
        python scripts/verify_delivered_snapshot.py --snapshot (Resolve-Path $Snapshot).Path
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
} finally {
    Pop-Location
}
$V4 = Join-Path $env:VIBUS_PROJECT_ROOT "quality-gates\v4-release-integrity\scripts\run-v4.ps1"
if (-not (Test-Path -LiteralPath $V4 -PathType Leaf)) { throw "Missing V4 runner: $V4" }
& powershell -ExecutionPolicy Bypass -File $V4 -ProjectRoot $env:VIBUS_PROJECT_ROOT -Snapshot $Snapshot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "`n[V5 BILLING LEDGER CLOSURE: PASS]"
