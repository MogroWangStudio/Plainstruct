/** 系统命令:打开路径/外链、刷新指定 webview */
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::state::{ensure_main, AppState};

#[tauri::command]
pub fn open_path(
    app: AppHandle,
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
    path: String,
) -> Result<(), String> {
    ensure_main(&window)?;
    // 仅允许打开当前站点目录内的路径,防止命令被不可信预览内容当作任意程序启动器
    let root = state.site_root()?;
    let target = PathBuf::from(&path);
    let canonical = target.canonicalize().map_err(|e| format!("路径不存在: {e}"))?;
    let root_canonical = root.canonicalize().unwrap_or_else(|_| root.clone());
    if canonical != root_canonical && !canonical.starts_with(&root_canonical) {
        return Err("forbidden-path".into());
    }
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_external(app: AppHandle, window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    ensure_main(&window)?;
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("仅支持 http/https 链接".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// 打开当前数据目录(路径来自全局状态而非前端输入,无任意路径风险)
#[tauri::command]
pub fn open_data_dir(app: AppHandle, state: State<'_, AppState>, window: tauri::WebviewWindow) -> Result<(), String> {
    ensure_main(&window)?;
    let dir = state.app_data();
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// 原地刷新指定 webview(不销毁窗口,保持位置与尺寸),用于独立预览窗口加载最新构建产物
#[tauri::command]
pub fn reload_webview(app: AppHandle, window: tauri::WebviewWindow, label: String) -> Result<(), String> {
    ensure_main(&window)?;
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("webview not found: {label}"))?;
    win.eval("window.location.reload()").map_err(|e| e.to_string())
}
