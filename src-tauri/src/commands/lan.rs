/** 局域网同步命令:服务开关、发现、推送、拉取与接收决定 */
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::lan::{self, LanPeer};
use crate::state::{ensure_main, AppState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanStatus {
    pub running: bool,
    pub http_port: u16,
    pub device_name: String,
    pub trusted: bool,
    pub session: String,
}

fn service_status_of(state: &AppState) -> LanStatus {
    match state.lan.lock().ok().and_then(|g| g.clone()) {
        Some(svc) => LanStatus {
            running: true,
            http_port: svc.http_port,
            device_name: svc.device_name(),
            trusted: svc.is_trusted(),
            session: svc.session.clone(),
        },
        None => LanStatus {
            running: false,
            http_port: 0,
            device_name: String::new(),
            trusted: false,
            session: String::new(),
        },
    }
}

fn device_name_default() -> String {
    match lan::platform_name() {
        "android" => "安卓设备".into(),
        "windows" => "Windows 电脑".into(),
        "macos" => "Mac".into(),
        "ios" => "iOS 设备".into(),
        _ => "Plainstruct 设备".into(),
    }
}

#[tauri::command]
pub fn lan_start_service(
    window: tauri::WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    device_name: Option<String>,
    trusted: Option<bool>,
) -> Result<LanStatus, String> {
    ensure_main(&window)?;
    let name = device_name.filter(|n| !n.trim().is_empty()).unwrap_or_else(device_name_default);
    let trusted = trusted.unwrap_or(false);
    lan::start_service(&app, &state, name, trusted)?;
    Ok(service_status_of(&state))
}

#[tauri::command]
pub fn lan_stop_service(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<LanStatus, String> {
    ensure_main(&window)?;
    lan::stop_service(&state)?;
    Ok(service_status_of(&state))
}

#[tauri::command]
pub fn lan_service_status(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<LanStatus, String> {
    ensure_main(&window)?;
    Ok(service_status_of(&state))
}

#[tauri::command]
pub fn lan_update_meta(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    device_name: Option<String>,
    trusted: Option<bool>,
) -> Result<LanStatus, String> {
    ensure_main(&window)?;
    let svc = state
        .lan
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("lan-not-running")?;
    if let Some(name) = device_name.filter(|n| !n.trim().is_empty()) {
        svc.set_device_name(name);
    }
    if let Some(trusted) = trusted {
        svc.set_trusted(trusted);
    }
    Ok(service_status_of(&state))
}

#[tauri::command]
pub fn lan_discover(window: tauri::WebviewWindow) -> Result<Vec<LanPeer>, String> {
    ensure_main(&window)?;
    lan::discover()
}

/// 本机站点库:数据目录 sites/ 下的全部站点(发送方选择与移动端打开共用)
#[tauri::command]
pub fn lan_local_sites(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<Vec<lan::LanSiteBrief>, String> {
    ensure_main(&window)?;
    Ok(lan::local_sites(&state))
}

/// 推送站点到对方(阻塞,由前端在后台任务中调用):打包当前打开的站点
#[tauri::command]
pub async fn lan_push_site(
    window: tauri::WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    peer: LanPeer,
    site_root: String,
) -> Result<String, String> {
    ensure_main(&window)?;
    drop(state);
    // 打包与传输都在阻塞线程执行,避免卡住命令运行时
    let svc = {
        let state = app.state::<AppState>();
        lan::active_service(&state)?
    };
    let peer = peer.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let root = std::path::PathBuf::from(&site_root);
        let (bundle, file_count) = lan::bundle_site(&root)?;
        let site_name = bundle.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
        let size_bytes = serde_json::to_vec(&bundle).map(|v| v.len() as u64).unwrap_or(0);
        let token = lan::push_plan(&svc, &peer, &site_name, size_bytes, file_count)?;
        lan::push_data(&peer, &token, &bundle)?;
        Ok(site_name)
    })
    .await
    .map_err(|e| e.to_string())?;
    result
}

/// 拉取对方站点(阻塞):对方须信任当前网络;落盘到本机 sites/(同名覆盖前自动备份)
#[tauri::command]
pub async fn lan_pull_site(
    window: tauri::WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    peer: LanPeer,
    site_name: String,
    mode: Option<String>,
) -> Result<String, String> {
    ensure_main(&window)?;
    drop(state);
    let peer = peer.clone();
    let mode = mode.unwrap_or_else(|| "copy".into());
    let applied = tauri::async_runtime::spawn_blocking(move || {
        let bundle = lan::pull_site_bundle(&peer, &site_name)?;
        let state = app.state::<AppState>();
        lan::apply_bundle(&state, &bundle, &mode)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(applied)
}

/// 用户决定收到的推送计划(accept + mode = copy / replace)
#[tauri::command]
pub fn lan_decide_incoming(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    accept: bool,
    mode: Option<String>,
) -> Result<bool, String> {
    ensure_main(&window)?;
    let token = lan::decide_incoming(&state, accept, mode.as_deref().unwrap_or("copy"))?;
    Ok(token.is_some())
}
