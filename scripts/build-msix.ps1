# Build an MSIX package for NovelSpine (Microsoft Store distribution).
#
# The Microsoft Store re-signs MSIX packages on submission, so a code-signing
# certificate is NOT required to submit. Use -SelfSign only to install/test the
# package locally before submitting.
#
# Usage (Store submission build):
#   .\scripts\build-msix.ps1 -IdentityName "1234Publisher.NovelSpine" `
#       -Publisher "CN=ABCD1234-..." -PublisherDisplayName "Your Name"
#
# Usage (local test build, self-signed so you can install it):
#   .\scripts\build-msix.ps1 -SelfSign
#
# Identity values come from Partner Center after you reserve the app as an
# "MSIX/PWA" product: Product management -> Product identity.

param(
    [string]$IdentityName = "NovelSpine.Desktop",
    [string]$Publisher = "CN=NovelSpineDev",
    [string]$PublisherDisplayName = "NovelSpine",
    [string]$DisplayName = "NovelSpine",
    [string]$Version = "1.0.0.0",
    [switch]$SelfSign,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "==> NovelSpine MSIX packaging" -ForegroundColor Cyan
Write-Host "Identity Name : $IdentityName"
Write-Host "Publisher     : $Publisher"
Write-Host "Version       : $Version"

# --- Locate Windows SDK tools (makeappx / signtool) ---
$BinRoot = "C:\Program Files (x86)\Windows Kits\10\bin"
$MakeAppx = Get-ChildItem $BinRoot -Recurse -Filter "makeappx.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\" } |
    Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $MakeAppx) { throw "makeappx.exe not found. Install the Windows 10/11 SDK." }
$SignTool = Get-ChildItem $BinRoot -Recurse -Filter "signtool.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\" } |
    Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
Write-Host "makeappx: $MakeAppx"

# --- Ensure the Tauri release binary + sidecar are built ---
# Cargo may build into a custom CARGO_TARGET_DIR (e.g. sandboxed CI/dev shells).
# Resolve the release output from there first, falling back to the in-tree target.
$TargetRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $Root "src-tauri\target" }
$ReleaseExe = Join-Path $TargetRoot "release\novelspine-desktop.exe"
if (-not (Test-Path $ReleaseExe)) {
    $ReleaseExe = Join-Path $Root "src-tauri\target\release\novelspine-desktop.exe"
}
$SidecarDir = Join-Path $Root "dist\novelspine-sidecar"
$Sidecar = Join-Path $SidecarDir "novelspine-sidecar.exe"
$SidecarInternal = Join-Path $SidecarDir "_internal"
$FfmpegDir = Join-Path $Root "src-tauri\resources\ffmpeg"

if (-not $SkipBuild) {
    $CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if (Test-Path $CargoBin) { $env:PATH = "$CargoBin;$env:PATH" }
    Write-Host "==> Building web UI + sidecar + release binary..." -ForegroundColor Cyan
    & (Join-Path $Root "scripts\fetch-ffmpeg.ps1")
    & (Join-Path $Root "scripts\build-sidecar.ps1")
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "web build failed" }
    # NOTE: must be tauri:build (real release build). "npm run tauri" is aliased to
    # "tauri dev" and would produce a debug binary in a temp target, leaving the
    # release exe stale so the MSIX ships an old embedded frontend.
    npm run tauri:build -- --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
    & (Join-Path $Root "scripts\stage-sidecar-internal.ps1")
}

if (-not (Test-Path $Sidecar)) {
    $SidecarDir = Join-Path $Root "src-tauri\binaries"
    $Sidecar = Join-Path $SidecarDir "novelspine-sidecar-x86_64-pc-windows-msvc.exe"
    $SidecarInternal = Join-Path $SidecarDir "_internal"
}

foreach ($f in @($ReleaseExe, $Sidecar)) {
    if (-not (Test-Path $f)) { throw "Required build artifact missing: $f (run without -SkipBuild)" }
}
if (-not (Test-Path $SidecarInternal)) {
    throw "Required sidecar _internal missing: $SidecarInternal (run without -SkipBuild)"
}
# ffmpeg + ffprobe are required for audiobook synthesis/merge. Fail loudly if absent
# so we never ship a package where "Create audiobook" silently fails.
foreach ($tool in @("ffmpeg.exe", "ffprobe.exe")) {
    if (-not (Test-Path (Join-Path $FfmpegDir $tool))) {
        throw "Required $tool missing in $FfmpegDir. Run scripts\fetch-ffmpeg.ps1 (or build without -SkipBuild)."
    }
}

# --- Stage the package payload ---
$Stage = Join-Path $Root "src-tauri\target\msix-stage"
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "Assets") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "ffmpeg") | Out-Null

Copy-Item $ReleaseExe (Join-Path $Stage "novelspine-desktop.exe") -Force
# Tauri resolves the sidecar next to the exe as novelspine-sidecar.exe (triple stripped).
Copy-Item $Sidecar (Join-Path $Stage "novelspine-sidecar.exe") -Force
$StageInternal = Join-Path $Stage "_internal"
if (Test-Path $StageInternal) { Remove-Item $StageInternal -Recurse -Force }
Copy-Item $SidecarInternal $StageInternal -Recurse -Force

if (Test-Path $FfmpegDir) {
    Get-ChildItem $FfmpegDir -File | Where-Object { $_.Name -notlike ".*" } |
        ForEach-Object { Copy-Item $_.FullName (Join-Path $Stage "ffmpeg\$($_.Name)") -Force }
}

Copy-Item (Join-Path $Root "src-tauri\msix\Assets\*") (Join-Path $Stage "Assets") -Force

# --- Write AppxManifest.xml from template ---
$Template = Get-Content (Join-Path $Root "src-tauri\msix\AppxManifest.template.xml") -Raw
$Manifest = $Template `
    -replace "{{IDENTITY_NAME}}", $IdentityName `
    -replace "{{PUBLISHER}}", $Publisher `
    -replace "{{PUBLISHER_DISPLAY_NAME}}", $PublisherDisplayName `
    -replace "{{DISPLAY_NAME}}", $DisplayName `
    -replace "{{VERSION}}", $Version
Set-Content -Path (Join-Path $Stage "AppxManifest.xml") -Value $Manifest -Encoding UTF8

# --- Pack the MSIX ---
$OutDir = Join-Path $Root "release"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Msix = Join-Path $OutDir "NovelSpine-$Version-x64.msix"
Write-Host "==> Packing MSIX..." -ForegroundColor Cyan
& $MakeAppx pack /d $Stage /p $Msix /o
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed" }
Write-Host "MSIX: $Msix" -ForegroundColor Green

# --- Optional self-sign for local install/testing ---
if ($SelfSign) {
    if (-not $SignTool) { throw "signtool.exe not found for self-signing." }
    Write-Host "==> Creating self-signed certificate for local testing..." -ForegroundColor Cyan
    $cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher `
        -KeyUsage DigitalSignature -FriendlyName "NovelSpine Test Cert" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
    $pwd = ConvertTo-SecureString -String "NovelSpineTest1!" -Force -AsPlainText
    $pfx = Join-Path $OutDir "novelspine-test-cert.pfx"
    Export-PfxCertificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" -FilePath $pfx -Password $pwd | Out-Null
    $cer = Join-Path $OutDir "novelspine-test-cert.cer"
    Export-Certificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" -FilePath $cer | Out-Null
    & $SignTool sign /fd SHA256 /a /f $pfx /p "NovelSpineTest1!" $Msix
    if ($LASTEXITCODE -ne 0) { throw "signtool sign failed" }
    Write-Host "Signed for local testing. To trust the cert (admin):" -ForegroundColor Yellow
    Write-Host "  Import-Certificate -FilePath `"$cer`" -CertStoreLocation Cert:\LocalMachine\Root" -ForegroundColor Yellow
    Write-Host "Then double-click the .msix to install." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
if (-not $SelfSign) {
    Write-Host "Upload $Msix to Partner Center. The Store signs it for you." -ForegroundColor Green
}
