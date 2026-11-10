# 走 GitHub Actions 出 exe

## 你要提供什么

| 需要 | 说明 |
|---|---|
| **GitHub 账号** | 没有就注册，2 分钟 |
| **一个空仓库** | public / private 都行。private 免费额度 2000 分钟/月，这次构建 6–10 分钟，跑得起 |
| **仓库地址** | 形如 `git@github.com:you/workbench.git` 或 `https://github.com/you/workbench.git` |
| **推送权限** | 主机上的 git 能推：SSH key，或 PAT |

**不需要**：Windows 机器、云账号、信用卡、签名证书、任何 repository secret。

Workflow 用的是 GitHub 自带的 `GITHUB_TOKEN`（只读 + artifact 上传），所以一个 secret 都不用配。

---

## 三步

### 1. 建仓库

GitHub → New repository → 名字随意（建议 `workbench`）。
**不要**勾 "Add a README"、"Add .gitignore"、"Choose a license"——留空仓库，否则推送时要先 merge。

### 2. 推代码

在主机上（不是我这边的会话里，我跑不了命令）：

```bash
cd /opt/dsh/workbench-client
bash scripts/push-to-github.sh git@github.com:你的用户名/workbench.git
```

脚本做四件事：`git init` → 提交 → `branch -M main` → 推到 origin。
`.gitignore` 已经排除了 `target/`、生成的图标、`node_modules/`。

推送凭据没配的话先做一次：

```bash
# 先验证 SSH 通不通
ssh -T git@github.com
```

### 3. 等 artifact

Actions 页面 → `build-windows` → 等 6–10 分钟 → 页面底部 **Artifacts** → 下载 `workbench-windows-x64.zip`。

解压得到两个文件：

```
workbench.exe                    ← 免安装，双击就开
Workbench_0.1.0_x64-setup.exe    ← 安装包（perMachine，装到 Program Files）
```

---

## 构建流程里实际发生了什么

```yaml
checkout
rust-toolchain (stable, target x86_64-pc-windows-msvc)
rust-cache (缓存 src-tauri/target，第二次起快很多)
cargo install tauri-cli --version "^2" --locked
cargo tauri icon assets/icon.svg -o src-tauri/icons   # 派生 ico/png 全套
cargo tauri build                                      # 前端零构建步骤，直接打包 ui/
upload-artifact
```

**没有 npm 步骤**。`ui/` 是静态文件，`tauri.conf.json` 的 `frontendDist` 直接指向 `../ui`。

---

## 六个可能红的地方（按概率排序）

### 1. `cargo tauri icon` 不吃 svg

tauri-cli v2 绝大多数版本支持 SVG 输入，但要是这一步报错，就是 SVG 解析问题。
**改法**：随便导一张 1024×1024 的 PNG，覆盖 `assets/icon.svg`，把 workflow 里的
`assets/icon.svg` 改成 `assets/icon.png`。一行。

### 2. 分支名不是 main

workflow 只监听 `push: branches: [main]`。如果推送后 Actions 里什么都没出现：
去 Actions 页面点 **Run workflow**（`workflow_dispatch` 已经配好），或者把分支改名成 main。

### 3. capabilities 里的权限标识符对不上

`src-tauri/capabilities/default.json` 里列了一串 `core:window:allow-*`。
Tauri v2 各小版本的权限名有过调整，如果编译期或运行期报 "permission not found"：
删掉那一行，或者换成该版本存在的名字。**不影响窗口能不能开，只影响最小化/最大化那几个按钮。**

### 4. NSIS 下载失败

`bundle.targets: ["nsis"]` 会让 Tauri 首次构建时去 GitHub releases 下 NSIS。
CI 里一般没问题；卡住就重跑一次。

### 5. `webview2-com-sys` 找不到 Windows SDK

`windows-latest` 预装了 SDK，正常不会缺。真缺了就在 workflow 里加一步装 WebView2 SDK 的 nuget。

### 6. artifact 上传报 "no files found"

说明 `cargo tauri build` 其实失败了但没被拦住，或者产物路径变了。
先看 build 步骤的日志；路径是 `src-tauri/target/release/workbench.exe`。

---

## 拿到 exe 之后怎么验

1. 双击 `workbench.exe`。窗口应该是无边框的、暖纸色背景，标题条左边三个小点（Windows 上会换成右边三个按钮，因为 `html[data-os="win"]` 生效了）
2. 等 1–2 秒它自己出现——窗口是 `visible:false` 起的，等前端首帧；万一前端脚本报错，3 秒后看门狗强制显示，不会变成没窗口的僵尸进程
3. 点侧栏「设置」→ 滚到底看「引擎」那屏，进程控制那行会显示真实状态
4. 顶栏「引擎未连」是正常的：`dsh` 不在这台 Windows 上，或者没加进 PATH

**第一次跑最可能出问题的地方**就是 `ui/app.js` 里那几个 `WB.tryCall` 的返回值期望，和设置页保存时 `readForm()` 的字段名要和 Rust 的 `store::Settings` 严格对齐（两边都是 snake_case）。出错的话控制台会有 `[wb]` 前缀的警告。

---

## 一句话

你只需要：**建一个空仓库，把地址给我，然后在主机上跑一条命令。**
剩下的都是 GitHub 的事，我负责在红了的时候改代码。