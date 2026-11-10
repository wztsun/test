#!/usr/bin/env bash
# ⚠️ 实验性：在 Ubuntu 上往 Windows 交叉编译 Tauri。
#
# 先说结论：Tauri 官方不支持 Linux → Windows 交叉编译。这条路能出「裸 exe」，
# 但安装包（NSIS）几乎出不来，而且 WebView2 的静态库要手工补。
# 想稳，用 Windows 机器或 GitHub Actions。
#
# 用法：
#   sudo bash scripts/setup-linux-cross.sh deps     # 只装 Linux 侧依赖
#   bash  scripts/setup-linux-cross.sh rust         # 装 rustup + windows target
#   bash  scripts/setup-linux-cross.sh xwin         # 装 cargo-xwin（下载量大）
#   bash  scripts/setup-linux-cross.sh exe          # 尝试产出裸 exe
#
# 注：本脚本没有在目标机上验证过（那台机跑不了命令），当作操作清单用。

set -euo pipefail

RUSTUP_MIRROR="${RUSTUP_MIRROR:-}"   # 国内可设 https://rsproxy.cn
CRATES_MIRROR="${CRATES_MIRROR:-}"   # 国内可设 https://rsproxy.cn/api/v1/crates

say() { printf '\n\033[1m→ %s\033[0m\n' "$*"; }

case "${1:-help}" in

deps)
  say "Linux 侧依赖（本就为了本地预览 Linux 窗口，不是为出 exe）"
  apt-get update
  apt-get install -y --no-install-recommends \
    pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev \
    libayatana-appindicator3-dev build-essential curl file
  echo "提示：pkg-config 是最容易被忽略的必需项，缺它 build.rs 直接失败。"
  ;;

rust)
  say "安装 rustup"
  if command -v rustc >/dev/null 2>&1; then
    echo "已有 rustc：$(rustc --version)"
  else
    if [ -n "$RUSTUP_MIRROR" ]; then
      export RUSTUP_DIST_SERVER="$RUSTUP_MIRROR"
      export RUSTUP_UPDATE_ROOT="$RUSTUP_MIRROR/rustup"
    fi
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  fi

  say "加 Windows target"
  rustup target add x86_64-pc-windows-msvc
  rustc --version && cargo --version
  ;;

xwin)
  say "安装 cargo-xwin（会拉 MSVC CRT + Windows SDK，1–2 GB）"
  if [ -n "$CRATES_MIRROR" ]; then
    echo "注意：镜像只在 .cargo/config.toml 里配 source replacement 才生效，这里只提示。"
  fi
  cargo install cargo-xwin --locked
  cargo xwin --version || true
  echo
  echo "⚠️ 下一步是这条路线最大的坑：WebView2 的 loader 静态库。"
  echo "   xwin 提供 MSVC CRT 与 Windows SDK 头/库，但不提供 WebView2 的 .lib。"
  echo "   需要自行下载 WebView2 SDK nuget 包，把其中的"
  echo "   x64/WebView2LoaderStatic.lib 放进 webview2-com-sys 期望的搜索路径。"
  echo "   找不到这一步的资料，就去用 Windows 原生编译，别在这上面耗。"
  ;;

exe)
  say "尝试构建裸 exe（不出安装包）"
  if [ ! -f src-tauri/Cargo.toml ]; then
    echo "请在仓库根目录执行（要能看到 src-tauri/）。" >&2
    exit 1
  fi
  cargo tauri icon assets/icon.svg -o src-tauri/icons
  # 只编 exe，跳过 bundle（NSIS 需要 wine，基本不会成功）
  cargo xwin build --release --target x86_64-pc-windows-msvc \
    --manifest-path src-tauri/Cargo.toml --no-default-features --features custom-protocol
  echo
  echo "产物：" src-tauri/target/x86_64-pc-windows-msvc/release/workbench.exe
  echo "验证：file 一下看是不是 PE32+，拷到 Windows 上双击。"
  ;;

*)
  sed -n '2,20p' "$0"
  ;;
esac