# 在 Windows 上出 exe：本机一条命令
# 用法（PowerShell，仓库根目录）：
#   .\scripts\build-windows.ps1
#   .\scripts\build-windows.ps1 -Dev        # 出调试版并直接运行
param([switch]$Dev)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "→ 检查工具链" -ForegroundColor Cyan
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "没找到 cargo。先装 Rust：https://rustup.rs  （需要 MSVC Build Tools，安装 rustup 时会提示）"
}
if (-not (Get-Command cargo-tauri -ErrorAction SilentlyContinue)) {
    Write-Host "→ 安装 tauri-cli（第一次要几分钟）" -ForegroundColor Cyan
    cargo install tauri-cli --version "^2" --locked
}

Write-Host "→ 生成图标（从 assets/icon.svg 派生 png/ico 全套）" -ForegroundColor Cyan
cargo tauri icon assets/icon.svg -o src-tauri/icons

if ($Dev) {
    Write-Host "→ 调试运行" -ForegroundColor Cyan
    cargo tauri dev
    exit 0
}

Write-Host "→ 编译 release（首次约 5-10 分钟）" -ForegroundColor Cyan
cargo tauri build

$exe = "src-tauri\target\release\workbench.exe"
$setup = Get-ChildItem "src-tauri\target\release\bundle\nsis\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1

Write-Host ""
Write-Host "完成：" -ForegroundColor Green
if (Test-Path $exe) { Write-Host "  单文件  $root\$exe" }
if ($setup)         { Write-Host "  安装包  $($setup.FullName)" }
Write-Host ""
Write-Host "注意：目标机需要 WebView2 运行时。Win11 自带；Win10 21H2+ 多数已带，缺了装 Microsoft Edge WebView2 Runtime。"