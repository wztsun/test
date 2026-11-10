# 环境审计 · 出 Windows exe 需要什么

审计时间：2026-11-10
方法：**读文件**（`/etc/os-release`、`/var/lib/dpkg/status`、`/proc/*`、文件系统探测）。
**这台机器上无法执行任何命令**（沙箱后端不可用），所以下面的"已装/缺失"来自包数据库与文件存在性，不是 `which` 的输出；标注"推断"的地方就是推断。

---

## 一、这台机器现在是什么

| 项 | 值 |
|---|---|
| 系统 | Ubuntu 24.04.4 LTS（noble） |
| 内核 | 6.6.116，gcc 13.3 构建 |
| 主机名 | dell-r750-1 |
| CPU | Intel Xeon @ 2.40 GHz，4 核（`hypervisor` 标志 → **本身是虚拟机**） |
| 内存 | 8.0 GB，可用 3.6 GB |
| 磁盘余量 | **未知**（读不到 statfs，需 `df -h`） |
| 角色 | 跑 DSH 的 Linux 服务器，不是开发机 |

## 二、已装（对构建有用）

| 组件 | 状态 | 用途 |
|---|---|---|
| gcc / g++ / make（build-essential） | 有 | 链接器、C 依赖 |
| git / curl / wget | 有 | 拉代码、拉工具链 |
| libssl-dev | 有 | 部分 crate 需要 |
| python3 | 有 | 脚本 |
| bubblewrap（`/usr/bin/bwrap`） | 有 | 但沙箱探测仍失败，见下 |
| libgtk-3-0t64 | 有（仅运行时） | 缺 `-dev` 头文件 |
| bun | 有（`~/.bunfig.toml`） | 与出 exe 无关 |

## 三、缺失（关键）

| 缺什么 | 影响 |
|---|---|
| **pkg-config / pkgconf** | Tauri 的 `build.rs` 第一步就挂，任何 Linux 侧构建都过不去 |
| **libwebkit2gtk-4.1 / 4.0**（dev 与 runtime 都没有） | Linux 上跑不了 Tauri 窗口；只影响本机预览，不影响出 exe |
| **librsvg2-dev** | 同上 |
| **Rust 工具链**（无 `~/.cargo`、无 `rustc/cargo` 包） | 从零开始：要装 rustup |
| **MinGW / wine / NSIS** | 目前没有任何 Windows 交叉编译能力，也没有做安装包的链路 |

## 四、网络（实测）

用外部抓取能力从这台机出网验证：

- `static.rust-lang.org` —— 通了（返回了响应，只是内容类型不可解码）
- `index.crates.io` —— 通了

**结论**：装工具链的下载通路是开的。但 crates.io / rustup CDN 在国内经常抽，实际装的时候建议配镜像（见脚本注释）。

## 五、为什么沙箱起不来

事实：`bwrap` 二进制在，内核 `max_user_namespaces = 31845`（没关），也没有 Ubuntu 24.04 那个 `apparmor_restrict_unprivileged_userns` 开关。

**推断**：这台机器本身跑在某种容器/受限环境里，`bwrap` 拿不到创建命名空间所需的权限（缺 CAP_SYS_ADMIN 或被 seccomp 拦）。所以 DSH 报"没有可用的沙箱后端"。

后果：不是装个包就能修的事。要么把 DSH 的文件策略切成 `danger-full-access`（承认风险），要么让这台机跑在能起 userns 的环境里。**这一步只能在 DSH 配置侧做，我在容器里改不了。**

---

## 六、出 exe 的三条路

### A. Windows 上原生编译 —— 推荐

一次性准备：

1. Windows 10/11 x64
2. **Visual Studio Build Tools 2022**，勾选「使用 C++ 的桌面开发」（3–5 GB）
3. **rustup**（默认 MSVC toolchain）
4. **WebView2 Runtime**（Win11 自带；Win10 装 Evergreen Bootstrapper）
5. Tauri CLI：`cargo install tauri-cli --version "^2" --locked`
6. NSIS —— Tauri 首次 `build` 时自动下载

磁盘 ≥ 8 GB 空闲；首次构建 10–20 分钟。
产出：`workbench.exe`（约 5 MB）+ `Workbench_0.1.0_x64-setup.exe`。

### B. GitHub Actions —— 零本机安装

仓库里已经有 `.github/workflows/build-windows.yml`，推到 GitHub 后从 artifact 下 `workbench-windows-x64`。
唯一的条件：能访问 github.com。

### C. 在这台 Linux 上交叉编译 —— 实验性，不推荐

Tauri 官方**不支持** Linux → Windows。社区路线是 `cargo-xwin`：

1. `pkg-config`（否则链路上任何 C 依赖都过不去）
2. rustup + `rustup target add x86_64-pc-windows-msvc`
3. `cargo install cargo-xwin`（按需拉 MSVC CRT 与 Windows SDK，1–2 GB）
4. **WebView2 loader 静态库** —— xwin 不提供，要自己放进 `webview2-com-sys` 期望的位置。这是最容易卡死的一步，也是这条路线最大的不确定性
5. 安装包还得 NSIS + wine

现实预期：**裸 `workbench.exe` 有概率出来；安装包基本出不来。**
真要走这条路，脚本见 `scripts/setup-linux-cross.sh`，但请先读脚本里的警告。

---

## 七、一句话总结

这台机现在**离出 exe 差一个 Rust 工具链 + 一套 Windows 编译链**，而且它本身还不是"能跑命令"的状态。
最快的路径不是在这台 Linux 上折腾，而是：**找一台 Windows（或开个 GitHub Actions），5 分钟出包。**

顺带一提：这台机连"本地预览 Linux 版 Tauri 窗口"都做不到，因为缺 `libwebkit2gtk-4.1-dev` 和 `pkg-config`。所以之前给你的单文件 HTML 预览，已经是这台机能给出的最接近"跑起来"的东西。