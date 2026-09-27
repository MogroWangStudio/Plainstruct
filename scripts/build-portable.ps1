$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "Building frontend and Tauri release executable..."
npm run tauri -- build --no-bundle

$exe = Join-Path $root "src-tauri\target\release\plainstruct.exe"
if (-not (Test-Path $exe)) {
  throw "Release executable not found: $exe"
}

$outDir = Join-Path $root "release\plainstruct-portable"
$zipPath = Join-Path $root "release\Plainstruct-x64-portable.zip"

if (Test-Path $outDir) {
  Remove-Item -LiteralPath $outDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Copy-Item -LiteralPath $exe -Destination $outDir

# 便携版标记:自动更新据此选择 zip 覆盖式更新(而非 NSIS 静默安装)
New-Item -ItemType File -Force -Path (Join-Path $outDir "portable.marker") | Out-Null

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path $outDir -DestinationPath $zipPath

Write-Host "Portable build ready: $zipPath"
