# Build the Novelflow API sidecar and copy it for Tauri externalBin.
# Usage: .\scripts\build-sidecar.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "Building sidecar with PyInstaller..."
python -m PyInstaller -y novelflow-sidecar.spec

$Built = Join-Path $Root "dist\novelflow-sidecar\novelflow-sidecar.exe"
if (-not (Test-Path $Built)) {
    throw "Expected sidecar at $Built"
}

$DestDir = Join-Path $Root "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
$Dest = Join-Path $DestDir "novelflow-sidecar-x86_64-pc-windows-msvc.exe"
Copy-Item -Force $Built $Dest
Write-Host "Copied to $Dest"
