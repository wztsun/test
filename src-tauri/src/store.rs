use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const FILE: &str = "settings.json";

/// 引擎（DeepSeek Harness）连接与启动参数。
/// 全部可在设置页里改，改完写回 settings.json，下次启动生效。
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct EngineCfg {
    /// 启动命令，默认假定 dsh 已在 PATH 上
    pub command: String,
    /// 启动参数
    pub args: Vec<String>,
    /// 引擎地址，UI 的连通性与代理都打这里
    pub url: String,
    /// 启动 cwd，空则沿用当前进程的
    pub workdir: String,
    pub autostart: bool,
    pub kill_on_exit: bool,
    /// 等端口就绪的上限秒数
    pub start_timeout_sec: u64,
    /// 发消息接口路径。留空 = 未接，UI 只在本地记账并明确提示。
    pub prompt_path: String,
    /// 审批接口路径。留空 = 未接。
    pub approve_path: String,
}

impl Default for EngineCfg {
    fn default() -> Self {
        Self {
            command: "dsh".into(),
            args: vec!["web".into()],
            url: "http://127.0.0.1:3080".into(),
            workdir: String::new(),
            autostart: true,
            kill_on_exit: true,
            start_timeout_sec: 25,
            prompt_path: String::new(),
            approve_path: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Tools {
    pub terminal: bool,
    pub fetch: bool,
    pub search: bool,
    pub subagent: bool,
}

impl Default for Tools {
    fn default() -> Self {
        Self { terminal: true, fetch: true, search: false, subagent: true }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Settings {
    /// every | risky | final
    pub approval: String,
    pub model: String,
    pub budget_cny: f64,
    pub downgrade_over_budget: bool,
    pub tools: Tools,
    pub workspace_root: String,
    /// light | dark
    pub theme: String,
    pub engine: EngineCfg,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            approval: "risky".into(),
            model: "V4.1 Flash".into(),
            budget_cny: 300.0,
            downgrade_over_budget: true,
            tools: Tools::default(),
            workspace_root: String::new(),
            theme: "light".into(),
            engine: EngineCfg::default(),
        }
    }
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("建不了配置目录：{e}"))?;
    Ok(dir)
}

pub fn load(app: &AppHandle) -> Result<Settings, String> {
    let path = config_dir(app)?.join(FILE);
    if !path.exists() {
        return Ok(Settings::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读不了配置：{e}"))?;
    // 配置文件被手改坏时不该让整个应用起不来，退回默认值。
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

#[tauri::command]
pub fn settings_load(app: AppHandle) -> Result<Settings, String> {
    load(&app)
}

#[tauri::command]
pub fn settings_save(app: AppHandle, settings: Settings) -> Result<(), String> {
    let path = config_dir(&app)?.join(FILE);
    let body = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, body).map_err(|e| format!("写不了配置：{e}"))
}

/// 在系统文件管理器里定位一个产物文件。
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在：{path}"));
    }

    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("调不起资源管理器：{e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("调不起 Finder：{e}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = p.parent().unwrap_or(p);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("调不起文件管理器：{e}"))?;
    }

    Ok(())
}