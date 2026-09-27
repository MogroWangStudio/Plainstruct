$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "Building frontend and Tauri release executable..."
npm run tauri -- build --no-bundle

$exe = Join-Path $root "src-tauri\target\release\plainstruct.exe"
if (-not (Test-Path $exe)) {
  throw "Release executable not found: $exe"
}

# 版本号取自 Cargo.toml(与应用版本同源),用于产物命名
$cargo = Get-Content (Join-Path $root "src-tauri\Cargo.toml") -Raw
$version = [regex]::Match($cargo, '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
if (-not $version) {
  throw "Version not found in Cargo.toml"
}

$name = "Plainstruct_${version}_Windows_x64_Portable"
$outDir = Join-Path $root "release\$name"
$zipPath = Join-Path $root "release\$name.zip"

if (Test-Path $outDir) {
  Remove-Item -LiteralPath $outDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Copy-Item -LiteralPath $exe -Destination $outDir

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path $outDir -DestinationPath $zipPath

Write-Host "Portable build ready: $zipPath"
