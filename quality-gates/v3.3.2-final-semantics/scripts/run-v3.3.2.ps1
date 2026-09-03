param(
  [Parameter(Mandatory=$true)]
  [string]$ProjectRoot
)
$ErrorActionPreference = 'Stop'
$GateDir = Split-Path -Parent $PSScriptRoot
$env:VIBUS_PROJECT_ROOT = (Resolve-Path $ProjectRoot).Path
Push-Location $GateDir
try {
  python .\verify_integrity.py
  python -m pytest .\tests
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  node --test .\tests-js\*.test.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
Push-Location (Join-Path $env:VIBUS_PROJECT_ROOT 'openspec-web')
try {
  npm run build:all
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
Write-Host "v3.3.2 PASS: 12/12 pytest + 3/3 Node + build:all" -ForegroundColor Green
