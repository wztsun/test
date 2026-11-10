use std::io::Read;
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::store;

/// 由本进程拉起的引擎子进程。None 表示没有托管任何东西（可能外部已有一个在跑）。
#[derive(Default)]
pub struct EngineState(pub Mutex<Option<Child>>);

#[derive(Serialize, Clone)]
pub struct Status {
    pub running: bool,
    pub pid: Option<u32>,
    pub owned: bool,
    pub url: String,
    pub reachable: bool,
}

#[derive(Serialize, Clone)]
pub struct HttpReply {
    pub status: u16,
    pub body: String,
}

const EVENT: &str = "engine-status";
/// 代理回包的正文上限，防止一次读进整个日志文件
const MAX_BODY: u64 = 262_144;

fn host_port(url: &str) -> (String, u16) {
    let rest = url.split("://").nth(1).unwrap_or(url);
    let hostport = rest.split('/').next().unwrap_or(rest);
    match hostport.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse().unwrap_or(80)),
        None => (hostport.to_string(), 80),
    }
}

/// 端口探测：能建立 TCP 连接就算活着。比打 HTTP 更轻，也不受路由权限影响。
pub fn probe(url: &str) -> bool {
    let (host, port) = host_port(url);
    let Ok(mut addrs) = (host.as_str(), port).to_socket_addrs() else {
        return false;
    };
    let Some(addr) = addrs.next() else {
        return false;
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

fn url_of(app: &AppHandle) -> String {
    store::load(app)
        .map(|s| s.engine.url)
        .unwrap_or_else(|_| "http://127.0.0.1:3080".into())
}

pub fn status_of(app: &AppHandle) -> Status {
    let url = url_of(app);
    let state = app.state::<EngineState>();
    let guard = state.0.lock().unwrap();
    let pid = guard.as_ref().map(|c| c.id());
    Status {
        running: pid.is_some(),
        pid,
        owned: pid.is_some(),
        reachable: probe(&url),
        url,
    }
}

pub fn emit_status(app: &AppHandle, phase: &str) -> Result<(), String> {
    app.emit(EVENT, phase).map_err(|e| e.to_string())
}

pub fn start_engine(app: &AppHandle) -> Result<Status, String> {
    if status_of(app).running {
        return Ok(status_of(app));
    }

    let cfg = store::load(app)?.engine;
    if cfg.command.trim().is_empty() {
        return Err("启动命令为空：请在设置里填 dsh 可执行文件路径".into());
    }

    let mut cmd = Command::new(cfg.command.trim());
    cmd.args(&cfg.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if !cfg.workdir.trim().is_empty() {
        cmd.current_dir(cfg.workdir.trim());
    }
    // Windows 上别弹出控制台黑框
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("拉起引擎失败（{}）：{e}", cfg.command))?;

    app.state::<EngineState>().0.lock().unwrap().replace(child);
    let _ = emit_status(app, "starting");

    let deadline = Instant::now() + Duration::from_secs(cfg.start_timeout_sec.max(1));
    let mut ready = false;
    while Instant::now() < deadline {
        if probe(&cfg.url) {
            ready = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(300));
    }

    let _ = emit_status(app, if ready { "ready" } else { "timeout" });
    Ok(status_of(app))
}

pub fn stop_engine(app: &AppHandle) -> Result<Status, String> {
    if let Some(mut child) = app.state::<EngineState>().0.lock().unwrap().take() {
        // kill 后必须 wait，否则 Windows 上会留僵尸句柄
        let _ = child.kill();
        let _ = child.wait();
        let _ = emit_status(app, "stopped");
    }
    Ok(status_of(app))
}

/// 关窗清理：只收拾自己拉起来的进程，外部已在跑的服务不碰。
pub fn shutdown(app: &AppHandle) {
    let kill = store::load(app).map(|s| s.engine.kill_on_exit).unwrap_or(true);
    if !kill {
        return;
    }
    if let Some(mut child) = app.state::<EngineState>().0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
pub fn engine_status(app: AppHandle) -> Result<Status, String> {
    Ok(status_of(&app))
}

#[tauri::command]
pub fn engine_start(app: AppHandle) -> Result<Status, String> {
    start_engine(&app)
}

#[tauri::command]
pub fn engine_stop(app: AppHandle) -> Result<Status, String> {
    stop_engine(&app)
}

/// 把引擎的 HTTP 接口代理给前端：WebView 直连会撞跨域，这里走本进程就没有 CORS 问题。
#[tauri::command]
pub fn engine_http(
    app: AppHandle,
    method: String,
    path: String,
    body: Option<String>,
) -> Result<HttpReply, String> {
    let base = url_of(&app);
    let full = if path.starts_with('/') {
        format!("{}{}", base.trim_end_matches('/'), path)
    } else {
        format!("{}/{}", base.trim_end_matches('/'), path)
    };

    let req = match method.to_uppercase().as_str() {
        "POST" => ureq::post(&full).set("content-type", "application/json"),
        "PUT" | "PATCH" => ureq::put(&full).set("content-type", "application/json"),
        _ => ureq::get(&full),
    }
    .timeout(Duration::from_secs(10));

    let result = match body {
        Some(b) => req.send_string(&b),
        None => req.call(),
    };

    fn drain(r: ureq::Response) -> (u16, String) {
        let status = r.status();
        let mut s = String::new();
        let _ = r.into_reader().take(MAX_BODY).read_to_string(&mut s);
        (status, s)
    }

    match result {
        Ok(r) => {
            let (status, body) = drain(r);
            Ok(HttpReply { status, body })
        }
        // 4xx/5xx 是正常回包，交给前端判断，不当异常抛
        Err(ureq::Error::Status(code, r)) => {
            let (_, body) = drain(r);
            Ok(HttpReply { status: code, body })
        }
        Err(e) => Err(format!("连不上引擎（{base}）：{e}")),
    }
}