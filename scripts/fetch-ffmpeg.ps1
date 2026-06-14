# Download ffmpeg essentials for bundling in the Windows installer.
# Usage: .\scripts\fetch-ffmpeg.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$OutDir = Join-Path $Root "src-tauri\resources\ffmpeg"
$Marker = Join-Path $OutDir ".ffmpeg-bundle"
$FfmpegExe = Join-Path $OutDir "ffmpeg.exe"

if ((Test-Path $FfmpegExe) -and (Test-Path $Marker)) {
    Write-Host "ffmpeg already bundled at $OutDir"
    exit 0
}

Write-Host "Downloading ffmpeg (Windows x64 essentials)..."
$ZipUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$ZipPath = Join-Path $env:TEMP "novelflow-ffmpeg.zip"
$ExtractRoot = Join-Path $env:TEMP "novelflow-ffmpeg-extract"

if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
if (Test-Path $ExtractRoot) { Remove-Item -Recurse -Force $ExtractRoot }

Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing
Expand-Archive -Path $ZipPath -DestinationPath $ExtractRoot

$BinDir = Get-ChildItem -Path $ExtractRoot -Recurse -Directory -Filter "bin" |
    Where-Object { Test-Path (Join-Path $_.FullName "ffmpeg.exe") } |
    Select-Object -First 1

if (-not $BinDir) {
    throw "Could not find ffmpeg.exe in downloaded archive"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Get-ChildItem -Path $BinDir.FullName -Include "ffmpeg.exe", "ffprobe.exe", "*.dll" -File |
    Copy-Item -Destination $OutDir -Force

$BuildDir = $BinDir.Parent
$License = Get-ChildItem -Path $BuildDir.FullName -Filter "*LICENSE*" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($License) {
    Copy-Item -Force $License.FullName (Join-Path $OutDir "FFMPEG-LICENSE.txt")
}

Set-Content -Path $Marker -Value "ffmpeg-release-essentials"
Write-Host "Bundled ffmpeg to $OutDir"
