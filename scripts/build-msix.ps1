# Build an MSIX package for Novelflow (Microsoft Store distribution).
#
# The Microsoft Store re-signs MSIX packages on submission, so a code-signing
# certificate is NOT required to submit. Use -SelfSign only to install/test the
# package locally before submitting.
#
# Usage (Store submission build):
#   .\scripts\build-msix.ps1 -IdentityName "1234Publisher.Novelflow" `
#       -Publisher "CN=ABCD1234-..." -PublisherDisplayName "Your Name"
#
# Usage (local test build, self-signed so you can install it):
#   .\scripts\build-msix.ps1 -SelfSign
#
# Identity values come from Partner Center after you reserve the app as an
# "MSIX/PWA" product: Product management -> Product identity.

param(
    [string]$IdentityName = "Novelflow.Desktop",
    [string]$Publisher = "CN=NovelflowDev",
    [string]$PublisherDisplayName = "Novelflow",
    [string]$DisplayName = "Novelflow",
    [string]$Version = "3.0.1.0",
    [switch]$SelfSign,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "==> Novelflow MSIX packaging" -ForegroundColor Cyan
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
$ReleaseExe = Join-Path $Root "src-tauri\target\release\novelflow-desktop.exe"
$Sidecar = Join-Path $Root "src-tauri\binaries\novelflow-sidecar-x86_64-pc-windows-msvc.exe"
$FfmpegDir = Join-Path $Root "src-tauri\resources\ffmpeg"

if (-not $SkipBuild) {
    $CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if (Test-Path $CargoBin) { $env:PATH = "$CargoBin;$env:PATH" }
    Write-Host "==> Building web UI + sidecar + release binary..." -ForegroundColor Cyan
    & (Join-Path $Root "scripts\build-sidecar.ps1")
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "web build failed" }
    npm run tauri build -- --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
}

foreach ($f in @($ReleaseExe, $Sidecar)) {
    if (-not (Test-Path $f)) { throw "Required build artifact missing: $f (run without -SkipBuild)" }
}

# --- Stage the package payload ---
$Stage = Join-Path $Root "src-tauri\target\msix-stage"
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "Assets") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "ffmpeg") | Out-Null

Copy-Item $ReleaseExe (Join-Path $Stage "novelflow-desktop.exe") -Force
# Tauri resolves the sidecar next to the exe as novelflow-sidecar.exe (triple stripped).
Copy-Item $Sidecar (Join-Path $Stage "novelflow-sidecar.exe") -Force

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
$Msix = Join-Path $OutDir "Novelflow-$Version-x64.msix"
Write-Host "==> Packing MSIX..." -ForegroundColor Cyan
& $MakeAppx pack /d $Stage /p $Msix /o
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed" }
Write-Host "MSIX: $Msix" -ForegroundColor Green

# --- Optional self-sign for local install/testing ---
if ($SelfSign) {
    if (-not $SignTool) { throw "signtool.exe not found for self-signing." }
    Write-Host "==> Creating self-signed certificate for local testing..." -ForegroundColor Cyan
    $cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher `
        -KeyUsage DigitalSignature -FriendlyName "Novelflow Test Cert" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
    $pwd = ConvertTo-SecureString -String "NovelflowTest1!" -Force -AsPlainText
    $pfx = Join-Path $OutDir "novelflow-test-cert.pfx"
    Export-PfxCertificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" -FilePath $pfx -Password $pwd | Out-Null
    $cer = Join-Path $OutDir "novelflow-test-cert.cer"
    Export-Certificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" -FilePath $cer | Out-Null
    & $SignTool sign /fd SHA256 /a /f $pfx /p "NovelflowTest1!" $Msix
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
