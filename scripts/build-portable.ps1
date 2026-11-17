$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "Building frontend and Tauri release executable..."
npm run tauri -- build --no-bundle

$exe = Join-Path $root "src-tauri\target\release\plainstruct.exe"
if (-not (Test-Path $exe)) {
  throw "Release executable not found: $exe"
}

# 版本号取自 package.json(与 Cargo.toml / tauri.conf.json 同源,CI 已三方校验),
# 用于产物命名;命名即协议 —— 应用内检查更新按「Windows + x64」识别该包
$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
if (-not $version) {
  throw "Version not found in package.json"
}

$name = "Plainstruct_${version}_Windows_x64"
$stage = Join-Path $root "release\_stage"
$zipPath = Join-Path $root "release\$name.zip"

if (Test-Path $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# 发行要求:压缩包内只有一个可执行程序,文件名固定为 Plainstruct.exe
Copy-Item -LiteralPath $exe -Destination (Join-Path $stage "Plainstruct.exe")

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $root "release") | Out-Null
Compress-Archive -Path (Join-Path $stage "Plainstruct.exe") -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item -LiteralPath $stage -Recurse -Force

Write-Host "Portable build ready: $zipPath"
