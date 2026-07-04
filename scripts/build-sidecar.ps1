# Build the NovelSpine API sidecar and copy it for Tauri externalBin.
# Usage: .\scripts\build-sidecar.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Stop-SidecarProcesses {
    $names = @(
        "novelspine-sidecar",
        "novelspine-sidecar-x86_64-pc-windows-msvc"
    )
    foreach ($name in $names) {
        Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
}

$OneDir = Join-Path $Root "dist\novelspine-sidecar"
$Built = Join-Path $OneDir "novelspine-sidecar.exe"
$BuiltInternal = Join-Path $OneDir "_internal"

Stop-SidecarProcesses
Start-Sleep -Milliseconds 500
if (Test-Path $OneDir) {
    Remove-Item $OneDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Building sidecar with PyInstaller (one-dir)..."
python -m PyInstaller -y novelspine-sidecar.spec
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path $Built)) {
    throw "Expected sidecar at $Built"
}
if (-not (Test-Path $BuiltInternal)) {
    throw "Expected sidecar _internal at $BuiltInternal"
}

$DestDir = Join-Path $Root "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
$Dest = Join-Path $DestDir "novelspine-sidecar-x86_64-pc-windows-msvc.exe"
Copy-Item -Force $Built $Dest
Write-Host "Copied to $Dest"

$InternalDest = Join-Path $DestDir "_internal"
if (Test-Path $InternalDest) {
    Remove-Item $InternalDest -Recurse -Force
}
Copy-Item $BuiltInternal $InternalDest -Recurse -Force
Write-Host "Copied _internal to $InternalDest"
Write-Host "One-dir bundle: $OneDir"
