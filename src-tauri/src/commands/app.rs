/** 应用级命令:bootstrap、设置、日志、数据存储位置 */
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::state::{ensure_main, AppState};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecentSite {
    pub name: String,
    pub path: String,
    pub opened_at: u64,
}

/// 数据文件(当前数据目录的 app.json)。
/// custom_data_dir 仅在默认目录的 app.json 中作为「引导指针」有意义:
/// 启动时按它把数据目录切到自定义位置,其余字段为真实数据。
#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppData {
    #[serde(default)]
    settings: Value,
    #[serde(default)]
    recent_sites: Vec<RecentSite>,
    #[serde(default)]
    pub(crate) custom_data_dir: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingUpdate {
    pub version: String,
    pub asset_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    version: String,
    platform: String,
    app_data_dir: String,
    /// 用户自定义的数据目录(None = 使用默认位置)
    custom_data_dir: Option<String>,
    settings: Value,
    recent_sites: Vec<RecentSite>,
    /// 已下载待安装的更新(存在时前端显示「重启并更新」)
    pending_update: Option<PendingUpdate>,
}

pub(crate) fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn read_app_data(state: &AppState) -> AppData {
    read_app_data_at(&state.app_data())
}

pub fn read_app_data_at(dir: &Path) -> AppData {
    let file = dir.join("app.json");
    std::fs::read_to_string(&file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write_app_data(state: &AppState, data: &AppData) -> Result<(), String> {
    write_app_data_to(&state.app_data(), data)
}

pub fn write_app_data_to(dir: &Path, data: &AppData) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let file = dir.join("app.json");
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    std::fs::write(file, json).map_err(|e| e.to_string())
}

/// 记录最近打开的站点(置顶去重,最多 8 条)
pub fn touch_recent(state: &AppState, name: &str, path: &str) {
    let mut data = read_app_data(state);
    data.recent_sites.retain(|s| s.path != path);
    data.recent_sites.insert(
        0,
        RecentSite {
            name: name.to_string(),
            path: path.to_string(),
            opened_at: now_millis(),
        },
    );
    data.recent_sites.truncate(8);
    let _ = write_app_data(state, &data);
}

#[tauri::command]
pub fn get_bootstrap(state: State<'_, AppState>, window: tauri::WebviewWindow) -> Result<Bootstrap, String> {
    ensure_main(&window)?;
    let data = read_app_data(&state);
    let platform = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "unknown"
    };
    let current = env!("CARGO_PKG_VERSION").to_string();
    // 已下载且版本更新的待安装任务(安装包须仍在,否则视为残留)
    let pending_update = crate::commands::github::read_update_task()
        .filter(|t| is_newer(&t.version, &current))
        .filter(|t| crate::commands::github::update_dir().join(&t.asset_name).exists())
        .map(|t| PendingUpdate { version: t.version, asset_name: t.asset_name });
    Ok(Bootstrap {
        version: current,
        platform: platform.to_string(),
        app_data_dir: state.app_data().to_string_lossy().to_string(),
        custom_data_dir: read_app_data_at(&state.default_data_dir()).custom_data_dir,
        settings: if data.settings.is_null() {
            serde_json::json!({ "locale": "zh-CN", "autosave": true, "theme": "system", "uiFont": "system", "editorFont": "default" })
        } else {
            data.settings
        },
        recent_sites: data.recent_sites,
        pending_update,
    })
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, window: tauri::WebviewWindow, patch: Value) -> Result<Value, String> {
    ensure_main(&window)?;
    let mut data = read_app_data(&state);
    // 全新安装时 app.json 不存在,settings 反序列化为 Null,先规范化为空对象
    if data.settings.is_null() {
        data.settings = serde_json::json!({});
    }
    let obj = data.settings.as_object_mut().ok_or("settings 损坏")?;
    if let Some(patch_obj) = patch.as_object() {
        for (k, v) in patch_obj {
            obj.insert(k.clone(), v.clone());
        }
    }
    write_app_data(&state, &data)?;
    Ok(data.settings)
}

#[tauri::command]
pub fn log_frontend(window: tauri::WebviewWindow, msg: String) -> Result<(), String> {
    ensure_main(&window)?;
    println!("[frontend] {msg}");
    Ok(())
}

/// 更改数据存储位置:None 恢复默认,Some(path) 迁移到自定义目录。
///
/// 数据本体始终存于「当前数据目录」的 app.json;默认目录的 app.json 额外承担
/// 引导指针(customDataDir),重启时据此切回自定义位置。迁移采用复制并在原
/// 目录保留备份,不删除任何文件。
#[tauri::command]
pub fn set_data_dir(
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
    path: Option<String>,
) -> Result<(), String> {
    ensure_main(&window)?;
    let default_dir = state.default_data_dir();
    let target: PathBuf = match &path {
        None => default_dir.clone(),
        Some(p) => {
            if p.trim().is_empty() {
                return Err("empty-path".into());
            }
            let dir = PathBuf::from(p);
            std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建目录: {e}"))?;
            // 可写探测:实际写入并删除一个探测文件
            let probe = dir.join(".plainstruct-write-test");
            std::fs::write(&probe, b"ok").map_err(|e| format!("目录不可写: {e}"))?;
            let _ = std::fs::remove_file(&probe);
            dir
        }
    };
    let current_dir = state.app_data();
    let current = read_app_data(state.inner());

    // 数据落到目标目录(指针字段不属于数据本体)
    if target != current_dir {
        let mut data = current.clone();
        data.custom_data_dir = None;
        write_app_data_to(&target, &data)?;
    }

    // 默认目录的引导文件:更新指针;恢复默认时把当前数据写回
    let mut pointer = if path.is_none() {
        let mut data = current.clone();
        data.custom_data_dir = None;
        data
    } else {
        read_app_data_at(&default_dir)
    };
    pointer.custom_data_dir = path;
    write_app_data_to(&default_dir, &pointer)?;

    // 运行时切换当前数据目录(读写即时生效,无需重启)
    if let Ok(mut guard) = state.app_data_dir.lock() {
        *guard = target;
    }
    Ok(())
}

/* ---------- 检查更新:对比 GitHub 最新 Release 与当前版本 ---------- */

pub(crate) const RELEASES_API: &str = "https://api.github.com/repos/MogroWang/Plainstruct/releases/latest";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_url: String,
    pub release_notes: String,
    pub published_at: String,
}

/// "v1.2.3" / "1.2.3" -> (1, 2, 3)
fn parse_semver(s: &str) -> Option<(u64, u64, u64)> {
    let core = s.trim().trim_start_matches(['v', 'V']);
    let core = core.split(['-', '+']).next()?;
    let mut it = core.split('.');
    Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?))
}

pub(crate) fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_semver(latest), parse_semver(current)) {
        (Some(a), Some(b)) => a > b,
        // 任一侧无法按 semver 解析时退化为字符串比较
        _ => latest.trim() != current.trim(),
    }
}

#[tauri::command]
pub async fn check_update(window: tauri::WebviewWindow) -> Result<UpdateInfo, String> {
    ensure_main(&window)?;
    let current = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::builder()
        .user_agent(concat!("plainstruct/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("网络客户端创建失败: {e}"))?;
    let resp = client
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("网络错误: {e}"))?;
    let status = resp.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err("仓库尚未发布任何 Release。".into());
    }
    if !status.is_success() {
        return Err(format!("GitHub API 返回 {status}"));
    }
    let json: Value = resp.json().await.map_err(|e| format!("解析响应失败: {e}"))?;
    let tag = json["tag_name"].as_str().unwrap_or("").trim().to_string();
    if tag.is_empty() {
        return Err("Release 数据缺少版本号。".into());
    }
    Ok(UpdateInfo {
        has_update: is_newer(&tag, &current),
        latest_version: tag.trim_start_matches(['v', 'V']).to_string(),
        release_url: json["html_url"].as_str().unwrap_or("").to_string(),
        release_notes: json["body"].as_str().unwrap_or("").trim().to_string(),
        published_at: json["published_at"].as_str().unwrap_or("").to_string(),
        current_version: current,
    })
}
