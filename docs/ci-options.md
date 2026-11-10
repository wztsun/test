# CI 平台怎么选（GitLab / Gitee / AppVeyor）

## 先把问题问对

不是"哪个平台能用"，而是：**谁能免费给你一台 Windows 虚拟机跑构建**。

Tauri 出 exe 必须用 MSVC 链，必须在一台 Windows 上跑（或者走那条极不可靠的交叉编译）。
所以判断标准只有一条：这个 CI 有没有 Windows runner。

| 平台 | 免费 Windows runner | 备注 |
|---|---|---|
| **GitHub Actions** | ✅ `windows-latest` | 公开库无限，私有库 2000 分钟/月 |
| **AppVeyor** | ✅ VS2022 镜像 | 公开库免费；私有库付费/试用 |
| **Azure Pipelines** | ✅ `windows-latest` | 公开库免费；私有库有免费额度 |
| **Cirrus CI** | ✅ | 公开库免费 |
| **GitLab.com** | ❌ | 共享 runner 基本只有 Linux（Docker executor）。Windows 是 hosted beta，免费账户不保证可用 |
| **Gitee Go** | ❓ 不保证 | 主要是 Linux 构建环境，Windows 支持取决于套餐，别押这个 |
| **自建 GitLab** | 取决于你 | 得在你们某台 Windows 上装 gitlab-runner |

## 结论

### 能登 GitHub → 用 GitHub Actions

配置已经写在 `.github/workflows/build-windows.yml`，推上去就行。

### 登不上 GitHub，但有 GitLab / Bitbucket 账号

两条：

1. **AppVeyor**（推荐）。`appveyor.yml` 已经放在仓库根目录。appveyor.com 支持用 GitHub / GitLab / Bitbucket 账号登录，然后把仓库接过来。它对**公开**仓库免费，原生 Windows + VS2022，构建步骤和 Actions 完全等价。
2. **Azure Pipelines**。Microsoft 账号登录，可选 GitHub 或 Azure Repos 作为源；如果你只想要 Windows 机器不想要 GitHub，Azure Repos 也够用。

### 只有 Gitee

代码托管放 Gitee 没问题（国内快），但**构建别指望 Gitee Go**：

- Windows 环境不保证
- 构建机在国内拉 crates.io 和 NSIS 的 GitHub release 反而更慢

更好的组合：**代码放 Gitee，构建在 Windows 本地做**（`scripts/build-windows.ps1` 一条命令），或者 Gitee 做镜像、实际构建走 AppVeyor。

### 公司内网有 GitLab

可以，但要在你们某台 Windows 上装 `gitlab-runner` 并打上 `windows` tag。问题是——**那台机器本身就能直接编译了**，CI 只是把它自动化。如果只是为了出一次包，不如直接在上面跑 `build-windows.ps1`。

真要配 `.gitlab-ci.yml`，说一声我写；但它只能在你有自己 runner 的前提下跑。

## 一句话

稀缺资源是"一台 Windows"，不是"哪个平台"。
免费提供 Windows 的只有那四家：GitHub Actions、AppVeyor、Azure Pipelines、Cirrus CI。
其中 Github Actions 和 AppVeyor 这个工程都已经配好了。