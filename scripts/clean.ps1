# Remove local build artifacts and old installers (keeps source + node_modules).
# Usage: .\scripts\clean.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Stop-SidecarProcesses {
    foreach ($name in @("novelspine-sidecar", "novelspine-sidecar-x86_64-pc-windows-msvc")) {
        Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
}

Stop-SidecarProcesses

$RemoveDirs = @(
    "build",
    "dist",
    "release",
    ".pytest_cache",
    "apps\web\dist",
    "src-tauri\target"
)

foreach ($rel in $RemoveDirs) {
    $path = Join-Path $Root $rel
    if (Test-Path $path) {
        Write-Host "Removing $rel..."
        try {
            Remove-Item -Recurse -Force $path -ErrorAction Stop
        } catch {
            Write-Host "  (skipped locked files in $rel - stop builds/installers and rerun clean)"
        }
    }
}

$SidecarBin = Join-Path $Root "src-tauri\binaries\novelspine-sidecar-x86_64-pc-windows-msvc.exe"
$SidecarInternal = Join-Path $Root "src-tauri\binaries\_internal"
if (Test-Path $SidecarBin) {
    Write-Host "Removing src-tauri\binaries\*.exe..."
    Remove-Item -Force $SidecarBin
}
if (Test-Path $SidecarInternal) {
    Write-Host "Removing src-tauri\binaries\_internal..."
    Remove-Item -Recurse -Force $SidecarInternal
}

foreach ($file in @("sidecar-test.log", "sidecar-test.err")) {
    $path = Join-Path $Root $file
    if (Test-Path $path) {
        Remove-Item -Force $path
    }
}

Write-Host "Cleanup complete."
