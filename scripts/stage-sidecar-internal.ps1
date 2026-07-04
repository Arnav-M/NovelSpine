# Copy PyInstaller one-dir _internal next to the release binary before Tauri bundles.
# Invoked via build.beforeBundleCommand in tauri.conf.json.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

$InternalSrc = Join-Path $Root "src-tauri\binaries\_internal"
$ReleaseDir = Join-Path $Root "src-tauri\target\release"

if (-not (Test-Path $InternalSrc)) {
    Write-Warning "Sidecar _internal not found at $InternalSrc — run scripts/build-sidecar.ps1 first."
    exit 0
}

if (-not (Test-Path $ReleaseDir)) {
    Write-Warning "Release directory not found at $ReleaseDir — skipping _internal staging."
    exit 0
}

$Dest = Join-Path $ReleaseDir "_internal"
if (Test-Path $Dest) {
    Remove-Item $Dest -Recurse -Force
}
Copy-Item $InternalSrc $Dest -Recurse -Force
Write-Host "Staged sidecar _internal -> $Dest"
