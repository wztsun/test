# 备选方案

前提先说清楚：**卡点是"这台 Linux 不能执行命令"**（沙箱后端不可用），不是缺工具链。所以下面按"要不要碰本机"分成两类。凡是要在本机编译的，都得先解决那件事。

---

## 甲类 · 不碰本机，借一台 Windows

### 甲-1 云上 Windows 按量付费 ← 最快拿到真 exe

腾讯云 / 阿里云开一台 Windows Server 2019+ 按量计费实例，2 核 4G 就够，几毛到一元一小时。

1. 远程桌面进去
2. 装 rustup（一路默认）
3. 装 VS Build Tools 2022，只勾「使用 C++ 的桌面开发」
4. 把工程传上去（或者 `git clone`）
5. PowerShell 里跑 `.\scripts\build-windows.ps1`
6. 把 `workbench.exe` 和 NSIS 安装包拖回来，关机销毁实例

**成本**：最便宜的路，一小时以内。**不需要**这台 Linux 参与任何一步。
**唯一要求**：有云账号。

### 甲-2 GitHub Actions（已配好）

推仓库 → Actions 跑 `build-windows` → 下 artifact `workbench-windows-x64`。
零安装、零成本。前提是能访问 github.com。

### 甲-3 没有 GitHub 时的 CI 替代

- **AppVeyor** —— 免费给公开仓库，原生 Windows 环境，正好能跑这个 workflow 的等价步骤
- **Azure Pipelines** —— 免费额度含 Windows agent，用 Microsoft 账号即可
- **Gitee Go / 腾讯 CNB** —— 国内访问快，但 Windows runner 支持不稳定，要试

---

## 乙类 · 在本机出 exe（须先修执行环境）

修法只有两条：DSH 把文件策略切成 `danger-full-access`，或者你自己 SSH 进去敲命令。
修完之后，有两条比 Rust 交叉编译更靠谱的路：

### 乙-1 Go + Wails 交叉编译 —— "不用换机器也能出真 exe"的唯一干净解

Go 从 Linux 编 Windows 是一等公民：`GOOS=windows GOARCH=amd64 go build`，得到的就是真 PE32+。

需要装：

```bash
sudo apt-get install -y golang gcc-mingw-w64-x86-64 pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

然后 `wails build -platform windows/amd64`（安装包还需 NSIS + wine，或者干脆只要裸 exe）。

**代价**：Rust 那套壳要重写成 Go——`engine.rs` + `store.rs` + `main.rs` 一共约 400 行，逻辑简单（spawn 子进程、探端口、读写 JSON、HTTP 代理），一天之内能搬完。

**收益**：`ui/` 三个文件**一个字都不用改**。当初选无框架纯 HTML 的价值就在这儿——换壳不换皮。

**不确定性**：Wails 的 Windows 目标要 CGO + mingw，个别版本的 webview2 绑定会报链接错误；安装包这步基本要 wine。裸 exe 成功率高。

### 乙-2 Bun 单文件 exe —— 最省事的 exe，但窗口靠系统 Edge

这台机上**有 bun**（`~/.bunfig.toml` 在）。Bun 支持跨目标编译：

```bash
bun build --compile --target=bun-windows-x64 ./server.js --outfile workbench.exe
```

得到一个自带运行时的 Windows 单文件 exe，里面跑一个小 HTTP 服务托管 `ui/`，然后：

```
msedge --app=http://127.0.0.1:PORT --window-size=1280,820
```

`--app` 模式是无地址栏的独立窗口，任务栏有图标，看着就是个桌面应用。

**收益**：不需要 MSVC、不需要 mingw、不需要 Rust，一条命令出 exe。
**代价**：窗口不是自绘的（Edge 会给一圈细边框，我们那套自绘标题栏就多余了）；依赖目标机有 Edge（Win10/11 都有）。
**不确定性**：Bun 跨目标编译要联网取目标运行时；`--compile` 产物能否正常拉起子进程没验证过。

### 乙-3 仍然想在 Rust / Tauri 上原样搞定

就是 `scripts/setup-linux-cross.sh` 那条路。缺 WebView2 loader 静态库，卡死率高。**不推荐**，但脚本留着了。

---

## 丙类 · 先不上 exe，今天就能"装上用"

### 丙-1 Edge 安装为应用（PWA 方式）

把 `ui/` 用任意静态服务器跑起来（`python -m http.server` 就行），在 Edge 里打开，菜单 → 应用 → **将此站点安装为应用**。
得到一个开始菜单条目 + 独立窗口 + 图标，行为接近原生应用。

**代价**：没有进程托管能力——不能替用户 spawn `dsh` 引擎，"客户端"这半边是空的。
**适用**：只想先看看用起来什么感觉，或者纯粹当界面壳。

### 丙-2 一个 .bat / .lnk 快捷方式

```bat
@echo off
start "" msedge --app="file:///%~dp0ui/index.html" --window-size=1280,820
```

双击就是个无浏览器框的窗口。零编译、零依赖（除了 Edge）。

**代价**：同丙-1，没有引擎托管。而且 `file://` 下 localStorage 可用、跨域受限。

### 丙-3 不考虑的方案

**HTA / mshta**：也能"不用编译就有个 Windows 窗口"，但那是 IE 的 Trident 内核。这套 CSS 用了 grid、自定义属性、`backdrop-*`，在 Trident 上会直接崩。**别走。**

**Linux 上跑 Windows 容器**：不可能，Windows 容器需要 Windows 内核，跟 wine 是两回事。

---

## 我的建议

1. **只想要 exe，越快越好** → 甲-1 云 Windows，一小时以内，不需要这台机做任何事。
2. **不想花钱、有 GitHub** → 甲-2，artifact 下来就是。
3. **希望以后我能在本机闭环出包** → 先放开沙箱，然后走乙-1（Go + Wails）。Rust 那 400 行重写一天的事，`ui/` 不用动。
4. **先要"用得上"** → 丙-1 或丙-2，今天就能双击打开。

最后一句实话：这套东西真正的风险不在编译，在**编译出来之后没有任何东西跑通过**。所以不管走哪条路，第一次跑起来时最可能暴露的问题都在 `ui/app.js` 的 IPC 调用和 `capabilities/default.json` 的权限名上，那是两处一行就能改的地方。