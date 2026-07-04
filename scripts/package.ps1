# Build NovelSpine for end users (Windows installer + portable zip).
# Usage: .\scripts\package.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

# Ensure cargo is on PATH (common after rustup install).
$CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $CargoBin) {
    $env:PATH = "$CargoBin;$env:PATH"
}
$env:CARGO_TARGET_DIR = Join-Path $Root "src-tauri\target"

Write-Host "==> NovelSpine packaging (Windows)" -ForegroundColor Cyan

# Read version from tauri.conf.json
$TauriConf = Get-Content (Join-Path $Root "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$Version = $TauriConf.version
Write-Host "Version: $Version"

# Icons required for NSIS/MSI
$IconIco = Join-Path $Root "src-tauri\icons\icon.ico"
if (-not (Test-Path $IconIco)) {
    Write-Host "==> Generating app icons..."
    npx tauri icon "src/novelspine/assets/icon.png" -o "src-tauri/icons"
}

Write-Host "==> Fetching bundled ffmpeg..."
& (Join-Path $Root "scripts\fetch-ffmpeg.ps1")

Write-Host "==> Building Python sidecar..."
& (Join-Path $Root "scripts\build-sidecar.ps1")

Write-Host "==> Building web UI + Tauri installers (this may take several minutes)..."
npm run tauri:build
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }

$BundleRoot = Join-Path $Root "src-tauri\target\release\bundle"
$NsisDir = Join-Path $BundleRoot "nsis"
$MsiDir = Join-Path $BundleRoot "msi"
$ReleaseDir = Join-Path $Root "release"
New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null

$SetupSrc = Get-ChildItem -Path $NsisDir -Filter "*-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$MsiSrc = Get-ChildItem -Path $MsiDir -Filter "*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $SetupSrc) {
    throw "NSIS installer not found under $NsisDir"
}

$SetupDest = Join-Path $ReleaseDir "NovelSpine-Setup-$Version-x64.exe"
Copy-Item -Force $SetupSrc.FullName $SetupDest
Write-Host "Installer: $SetupDest" -ForegroundColor Green

if ($MsiSrc) {
    $MsiDest = Join-Path $ReleaseDir "NovelSpine-$Version-x64.msi"
    Copy-Item -Force $MsiSrc.FullName $MsiDest
    Write-Host "MSI:       $MsiDest" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Share NovelSpine-Setup-$Version-x64.exe with users (double-click to install)." -ForegroundColor Cyan
Write-Host "ffmpeg is bundled - users do not need a separate install." -ForegroundColor Green
