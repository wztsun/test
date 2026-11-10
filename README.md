# Workbench · 智能体工作台（桌面客户端）

一个 Windows 桌面客户端：给 DeepSeek Harness 套一层原生壳，界面是那套「暖纸面 + 朱砂强调色」的工作台设计。

- **壳**：Tauri v2（Rust + 系统 WebView2）
- **界面**：纯 HTML/CSS/JS，无框架、无打包器、无 npm 依赖
- **引擎**：托管并连接一个本地 `dsh` 进程；进程生命周期由客户端管

---

## 一、为什么是 Tauri

需求约束：① 产出 `.exe`；② 界面必须原样保留现在这套 CSS 设计；③ 要能拉起并监管本地进程；④ 别背一个 Chromium。

| 方案 | exe | 常驻内存 | 启动 | 现有设计复用 | 本机进程能力 | 从 Linux 交叉编译 |
|---|---|---|---|---|---|---|
| **Tauri v2** | **~4–6 MB** | **~70 MB** | ~0.3 s | **100%，就是 HTML/CSS** | Rust，随便调 | ❌ 官方不支持 |
| Wails v2 | ~10–14 MB | ~85 MB | ~0.4 s | 100% | Go，很好用 | ✅ `GOOS=windows` |
| Electron | ~95–150 MB | ~180–250 MB | ~1.2 s | 100% | Node，最好用 | ✅ 需 wine |
| Flutter | ~25 MB | ~90 MB | ~0.8 s | ✗ 要重写成 Widget | FFI | ❌ |
| egui / Slint | ~4 MB | ~45 MB | ~0.1 s | ✗ 要重写成 Rust UI | Rust | ✅ |

选 Tauri 的三个真实理由：

1. **设计零损耗**。这套界面是手写 CSS（纸面内嵌、1px 边、等宽数字、单一强调色），只有 WebView 方案能一字不改地搬过去。egui/Slint 体积更小，但等于把设计稿推倒重画。
2. **体积是 Electron 的 1/25**。内网分发、升级包大小、开机自启的体验都取决于这个数。
3. **Rust 侧正好干它擅长的事**：spawn 子进程、等端口就绪、读写配置、做 HTTP 代理。不需要 Node 运行时。

代价（要认）：Windows 上依赖 WebView2 运行时。Win11 自带；Win10 21H2+ 绝大多数已带。彻底离线分发时，安装包里带 WebView2 bootstrapper 即可，代价是包大 ~1.5 MB。

---

## 二、目录

```
workbench-client/
├── ui/                        前端（直接是 Tauri 的 frontendDist，无构建步骤）
│   ├── index.html             三屏结构：工作台 / 任务 / 设置
│   ├── styles.css             全部视觉，深浅两套 token
│   ├── app.js                 渲染、交互、引擎状态机
│   ├── bridge.js              与 Rust 的唯一接口 + 浏览器降级
│   └── data.js                种子数据（界面上所有数字的唯一来源）
├── src-tauri/
│   ├── src/main.rs            builder / 窗口 / 启动看门狗
│   ├── src/engine.rs          引擎进程托管 + HTTP 代理
│   ├── src/store.rs           settings.json 读写、产物定位
│   ├── tauri.conf.json        窗口：无边框自绘、1280×820、min 900×600
│   └── capabilities/default.json
├── assets/icon.svg            图标源（构建时派生出 png/ico 全套）
├── scripts/build-windows.ps1  Windows 本机构建
├── scripts/push-to-github.sh  推分支、可选打 tag
├── LICENSE                    MIT
├── .github/workflows/
│   ├── build-windows.yml      推 main 出 artifact，用来验证能不能编译
│   └── release.yml            打 v* tag 自动发 GitHub Release
```

---

## 三、出 exe 的两条路

### A. 有 Windows 机器（推荐，5–10 分钟）

```powershell
# 前置：Rust（https://rustup.rs，装的时候勾上 MSVC Build Tools）
cd workbench-client
.\scripts\build-windows.ps1
```

产出：

- `src-tauri\target\release\workbench.exe` —— 单文件，可直接拷走
- `src-tauri\target\release\bundle\nsis\Workbench_0.1.0_x64-setup.exe` —— 安装包

调试：`.\scripts\build-windows.ps1 -Dev`

如果 `cargo tauri icon` 不认这个 svg，随便导一张 1024×1024 的 png 覆盖 `assets/icon.svg` 的位置再跑一次即可。

### B. 没有 Windows 机器（CI 出包）

推到 GitHub，Actions 跑 `build-windows`，从 artifact 下 `workbench-windows-x64`。
工作流里没有任何 npm 步骤——前端不需要构建。

### ⚠️ 不能在 Linux 上交叉编译

Tauri 官方不支持 Linux → Windows 交叉编译（要 cargo-xwin + WebView2 nuget + wine 跑 NSIS，链路上任何一环都可能静默产出坏包）。**别在这上面省事**，用 Windows 或 CI。

---

## 四、现在做到哪了

### 真的通了

| 能力 | 实现 |
|---|---|
| 自绘窗口 | `decorations:false`；标题条 `data-tauri-drag-region` 可拖；Windows 右侧原生三键（最小化/最大化/关闭） |
| 引擎进程托管 | `engine_start` 找 `dsh` → spawn（Windows 无黑框）→ 每 300 ms 探端口直到通 → 超时返回 |
| 引擎挂载 | 已有服务在跑就不重复拉起，直接挂上（`attached`），关窗也不动它 |
| 引擎状态 | 每次 `engine_status` 做 TCP 探测，前端每 6 s 刷、窗口隐藏时停 |
| HTTP 代理 | `engine_http(method, path, body)` 走 Rust，绕开 WebView 跨域；4xx/5xx 当正常回包交给前端判断，正文截断 256 KB |
| 配置持久化 | `%APPDATA%\cn.tianxiaxiu.workbench\settings.json`；坏档自动退回默认值 |
| 退出清理 | 关窗时 kill 自己拉起的子进程（可关）；`kill` 后必 `wait`，避免 Windows 僵尸句柄 |
| 产物定位 | `reveal_path` → 资源管理器选中该文件 |
| 主题 | 深浅两套完整 token（不是反转），持久化 |
| 启动兜底 | 窗口 `visible:false` 等首帧；前端挂了 3 秒后强制 show |

### 还没接（是「接口留好了」，不是「做完了」）

- **发消息 / 审批的真实协议**。DSH 的会话 API 我没有对着跑通过的契约，所以没有编一个假 endpoint。设置页里 `发消息接口` / `审批接口` 两个输入框留空时，界面明确说「只记在本地」；填上路径就会真的 POST 到 `引擎地址 + 路径`。这两个框就是协议接缝。
- **执行轨的实时流**。现在第 1–6 步是种子数据。要变真，需要在 Rust 侧订阅引擎事件流（SSE / WebSocket mux）并 emit 给前端——见下一步。
- **任务表 / 运行栏的数据源**。同上是 `data.js`。

### 没验证（这是最重要的部分）

本机 `bash` 被沙箱挡住、没有 Rust 工具链，所以：

- **没有编译过**，没有跑起来过，没有截图。
- 代码是按 Tauri v2 的 API 写的，个别标识符（capabilities 里的权限名、`window.__TAURI__.window.getCurrentWindow`）若版本对不上，会在编译期或首个 IPC 调用时暴露，改法都在对应文件里一行。

---

## 五、和引擎的接缝

`settings.json` → `engine` 段（也是设置页「引擎」那一屏的字段）：

```json
{
  "command": "dsh",
  "args": ["web"],
  "url": "http://127.0.0.1:3080",
  "autostart": true,
  "kill_on_exit": true,
  "start_timeout_sec": 25,
  "prompt_path": "",
  "approve_path": ""
}
```

IPC 命令（`ui/bridge.js` 里统一封装）：

| 命令 | 作用 |
|---|---|
| `engine_status` | `{running, pid, owned, url, reachable}` |
| `engine_start` / `engine_stop` | spawn / kill+wait，返回最新状态 |
| `engine_http` | `{method, path, body}` → `{status, body}` |
| `settings_load` / `settings_save` | 整份配置读写 |
| `reveal_path` | 文件管理器里定位 |

**为什么用 Rust 代理而不是前端直接 fetch**：WebView 的 origin 是 `http://tauri.localhost`，直连 `127.0.0.1:3080` 会撞 CORS——除非去改引擎的响应头。走本进程没有这个问题，顺便加了超时和正文上限。

---

## 六、下一步（按优先级）

1. **订阅引擎事件流**：Rust 侧 `ureq` 流式读 SSE 或加 `tungstenite` 连 `/api/remote.mux`，把帧 emit 成 `run-event`，前端把静态执行轨换成 append。这是让界面「活」起来的那一步。
2. **补全协议字段**：把 `prompt_path` / `approve_path` 填成真实路径，跑通一次「发送 → 卡审批 → 批准 → 继续」。
3. **托盘 + 全局快捷键**：Tauri `tray-icon` 插件，长任务跑着的时候能收窗。
4. **空态 / 加载态 / 错误态**：任务表空筛选已有；执行轨、产物列表还是种子。
5. **签名**：内网分发可以省，对外发必须有代码签名，否则 SmartScreen 拦。详见下一节。

---

## 七、发布

协议是 MIT（见 `LICENSE`）：别人可以自由使用、修改、闭源再分发。

发版三步：

```bash
# 1. 改版本号（唯一需要手改的地方）：src-tauri/tauri.conf.json → version
# 2. 提交、推分支、打 tag（脚本会校验 tag 和 version 对不对得上）
bash scripts/push-to-github.sh git@github.com:wztsun/test.git v0.1.1
# 3. 等 release 工作流跑完，去 Releases 页拿包
```

`.github/workflows/release.yml` 干的事：校验 tag 与 `version` 一致 → 编译 → 把
`Workbench.exe` 和 `Workbench_x.y.z_x64-setup.exe` 挂到 GitHub Release 上，附自动生成的
changelog。Release 页的包**不需要登录就能下载**，这点和 Actions 的 artifact 不同，适合直接发给别人。

### 代码签名（还没做）

未签名的 exe 会被 SmartScreen 拦，国内杀软也可能报成木马。两条路：

- **开源免费**：SignPath 的 [open-source 计划](https://signpath.io/solutions/open-source-community)。签名在 CI 里做——这也是它要求项目用受支持的构建系统的原因，本项目的 GitHub Actions 正好符合。
- **付费**：Certum OV（最便宜的正规选项，年费约一千）或 EV 证书（签完立即有信誉，贵三倍）。

注意签名证书和 TLS 证书是两种东西，Let's Encrypt / certbot 签的那种不能用来签 exe——它不带 code signing 扩展用途。

### 自动更新（还没接）

Tauri updater 用的是自己生成的 minisign 密钥对，跟代码签名证书无关，管的是「更新包没被篡改」。
接它需要：`bundle.createUpdaterArtifacts: true`、一对密钥（私钥进 Secrets、公钥进配置）、
以及一个 `latest.json` 的托管位置（Release 附件即可）。

---

## 八、开发时的一点约束

`ui/` 里的三个文件浏览器直接打开也能跑（`WB.native === false`，全部降级为本地演示，配置存 localStorage）。所以调界面不需要编译 Rust——`ui/index.html` 双击就行，这是这个架构最舒服的地方。

注意是**打开文件夹里的 index.html**（要能读到同目录的 styles.css / app.js / data.js），单独拷走这一个 html 会变成裸文本。