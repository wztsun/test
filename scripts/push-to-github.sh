#!/usr/bin/env bash
# 把工程推到一个空的 GitHub 仓库，然后让 Actions 出 exe。
#
# 用法（在仓库根目录，或任意位置用绝对路径调）：
#   bash scripts/push-to-github.sh git@github.com:你的用户名/workbench.git
#   bash scripts/push-to-github.sh https://github.com/你的用户名/workbench.git
#
# 前置：
#   1. 已在 GitHub 上建好一个空仓库（不要勾 README / .gitignore / license，否则要 merge）
#   2. 本机 git 有推送凭据：
#      - SSH 方式：ssh -T git@github.com 能通
#      - HTTPS 方式：配了 PAT（Settings → Developer settings → Personal access tokens）
#
# 这个脚本只做本地 git 初始化 + 推送，不碰你的工程文件。

set -euo pipefail

REPO="${1:-}"
if [ -z "$REPO" ]; then
  sed -n '2,16p' "$0"
  exit 1
fi

cd "$(dirname "$0")/.."
echo "→ 工程根目录：$(pwd)"

# 1. 初始化
if [ ! -d .git ]; then
  git init -q
  echo "→ 已 git init"
else
  echo "→ 已有 .git，跳过 init"
fi

# 2. 提交身份：没配过就临时给一个，不写入全局配置
if ! git config user.email >/dev/null 2>&1; then
  git config user.name  "workbench-builder"
  git config user.email "workbench@localhost"
  echo "→ 未配置 git 身份，已在本仓库内临时设置（不影响全局）"
fi

# 3. 提交
git add -A
if git diff --cached --quiet 2>/dev/null; then
  echo "→ 没有新改动可提交"
else
  git commit -q -m "Workbench 客户端：Tauri v2 工程 + UI"
  echo "→ 已提交"
fi
git branch -M main

# 4. 远端
git remote remove origin >/dev/null 2>&1 || true
git remote add origin "$REPO"
echo "→ 远端：$REPO"

# 5. 推送
echo "→ 推送中…"
if ! git push -u origin main; then
  cat <<'EOF'

────────────────────────────────────────
推送被拒了。最常见的原因：建仓库时勾了 README / .gitignore / license，
远端已经有一个提交，和本地历史不相干（non-fast-forward）。

如果那仓库是新建的、没有你要保留的东西，直接覆盖：
    git push -u origin main --force

如果远端有内容得留着，先合一下再推：
    git pull --rebase origin main
    git push -u origin main

另一种可能是凭据没配：
    ssh -T git@github.com        # 出现 "Hi <用户名>!" 就对了
────────────────────────────────────────
EOF
  exit 1
fi

cat <<'EOF'

────────────────────────────────────────
推完了。接下来：

1. 打开 https://github.com/<你>/<仓库>/actions
2. 应该能看到 build-windows 正在跑（如果没有，点「Run workflow」手动触发）
3. 等 6-10 分钟，点进去看 job
4. 页面底部 Artifacts → 下载 workbench-windows-x64.zip
5. 解压得到：
     workbench.exe                       ← 免安装，双击就开
     Workbench_0.1.0_x64-setup.exe       ← 安装包

如果 job 红了：把失败那一步的日志贴出来，多数是图标生成或权限标识符，
都是一行能改的地方。
────────────────────────────────────────
EOF