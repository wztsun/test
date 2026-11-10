#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Workbench — 桌面壳。
//!
//! 分工：
//!   Rust  窗口生命周期、引擎进程托管、配置文件读写、把引擎的 HTTP 代理给前端（绕开 WebView 的跨域限制）
//!   UI    全部界面与交互，纯 HTML/CSS/JS，无打包器、无 npm 依赖
//!
//! 刻意不引 reqwest/tokio-tungstenite：本机回环只需要一个同步 HTTP 客户端，
//! ureq 依赖少、编译快、出错容易定位。WebSocket 由 WebView 直连（WS 不触发 CORS）。

mod engine;
mod store;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .manage(engine::EngineState::default())
        .invoke_handler(tauri::generate_handler![
            engine::engine_status,
            engine::engine_start,
            engine::engine_stop,
            engine::engine_http,
            store::settings_load,
            store::settings_save,
            store::reveal_path,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // 首启自动拉起引擎。放独立线程：start_engine 会阻塞等端口可用，不能占住 setup。
            std::thread::spawn(move || {
                let cfg = match store::load(&handle) {
                    Ok(s) => s.engine,
                    Err(_) => return,
                };
                if !cfg.autostart {
                    return;
                }
                // 已经有服务在跑就直接挂上去，不重复启动。
                if engine::probe(&cfg.url) {
                    let _ = engine::emit_status(&handle, "attached");
                    return;
                }
                let _ = engine::start_engine(&handle);
            });

            // 窗口是 visible:false 起的，等前端首帧画完再 show。
            // 万一前端脚本挂了，3 秒后强制显示——不能因为一个 JS 报错就变成没窗口的僵尸进程。
            let watchdog = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(3000));
                if let Some(win) = watchdog.get_webview_window("main") {
                    if !win.is_visible().unwrap_or(false) {
                        let _ = win.show();
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // 关窗时按配置收拾自己拉起来的引擎子进程，避免留下孤儿端口。
            if matches!(event, tauri::WindowEvent::Destroyed | tauri::WindowEvent::CloseRequested { .. }) {
                engine::shutdown(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("Workbench 启动失败");
}