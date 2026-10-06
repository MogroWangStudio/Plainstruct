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

/// 「刷新时禁用动画」设置(site:// 预览注入用);每次页面响应读一次,
/// app.json 不足 1KB,预览刷新频率下开销可忽略;缺字段按关闭处理
pub fn refresh_anim_disabled(state: &AppState) -> bool {
    read_app_data(state)
        .settings
        .get("disableRefreshAnim")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
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

/// settings 的完整默认表:历史数据可能缺字段(全新数据目录上第一次更改的
/// 设置若不是语言,落盘的 settings 里就没有 locale),读取时必须补齐,
/// 否则前端 settings.locale 为 undefined 会让启动初始化崩溃、画面滞留
pub(crate) fn settings_defaults() -> Value {
    serde_json::json!({
        "locale": "zh-CN",
        "autosave": true,
        "autosaveDelay": 900,
        "disableRefreshAnim": false,
        "theme": "system",
        "uiFont": "system",
        "uiFontSize": 1,
        "uiFontWeight": 400,
        "editorFont": "default",
        "editorWhitespace": true,
        "editorBreakKey": "enter",
        "editorIndentKey": "tab",
        "editorIndentWidth": 2,
        "modalBlur": true,
        "confetti": "standard",
    })
}

/// 以默认表补齐 settings 的缺失字段(已有值不动)
pub(crate) fn settings_with_defaults(settings: &Value) -> Value {
    let mut merged = settings_defaults();
    if let (Some(base), Some(supplied)) = (merged.as_object_mut(), settings.as_object()) {
        for (k, v) in supplied {
            base.insert(k.clone(), v.clone());
        }
    }
    merged
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
        // 缺失字段补默认:老数据 / 全新数据目录上首次保存的部分设置也能完整返回
        settings: settings_with_defaults(&data.settings),
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
    // 落盘前补齐缺失默认字段:只写过单个设置的旧 settings 就地自愈
    if let Some(def) = settings_defaults().as_object() {
        if let Some(obj) = data.settings.as_object_mut() {
            for (k, v) in def {
                obj.entry(k.clone()).or_insert(v.clone());
            }
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

/* ---------- 启动自愈:白屏(WebView 浏览数据损坏)的检测与分级恢复 ----------
 *
 * 白屏的经典根因是 WebView2/WKWebView 的用户数据(磁盘缓存、Code Cache、GPU 缓存)
 * 损坏:应用更新解压覆盖、WebView2 运行时自动升级、进程被强杀都可能诱发;清除
 * 浏览数据即恢复。自愈按连续失败次数分级:1=重载,2=清浏览数据后重载,
 * ≥3=放弃并显示诊断信息交人工处理。前端启动成功后调用 report_boot_success 清零,
 * 因此正常使用不会累积计数;失败详情落盘 boot-failures.log 供远程排障。 */

const BOOT_STATE_FILE: &str = "boot-state.json";
const BOOT_LOG_FILE: &str = "boot-failures.log";
/// 保留的失败日志行数上限
const BOOT_LOG_KEEP: usize = 20;
/// detail 截断长度,防止超长堆栈撑爆状态文件
const BOOT_DETAIL_MAX: usize = 2000;

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BootState {
    /// 连续启动失败次数(启动自愈分级依据;lib.rs setup 的预防性清理也会读取)
    #[serde(default)]
    pub(crate) failures: u32,
    #[serde(default)]
    last_stage: String,
    #[serde(default)]
    last_detail: String,
    #[serde(default)]
    last_at: u64,
}

pub(crate) fn read_boot_state(state: &AppState) -> BootState {
    let file = state.app_data().join(BOOT_STATE_FILE);
    std::fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub(crate) fn reset_boot_state(state: &AppState) {
    let _ = write_boot_state(state, &BootState::default());
}

fn write_boot_state(state: &AppState, data: &BootState) -> Result<(), String> {
    let dir = state.app_data();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(BOOT_STATE_FILE), json).map_err(|e| e.to_string())
}

/// 追加一条失败记录到 boot-failures.log,只保留最近 BOOT_LOG_KEEP 行
fn append_boot_log(state: &AppState, entry: &BootState) {
    let dir = state.app_data();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let file = dir.join(BOOT_LOG_FILE);
    let detail = entry.last_detail.replace(['\n', '\r'], " ");
    let line = format!(
        "[{}] #{} {} {}\n",
        now_millis(),
        entry.failures,
        entry.last_stage,
        detail
    );
    let mut lines: Vec<String> = std::fs::read_to_string(&file)
        .map(|s| s.lines().map(String::from).collect())
        .unwrap_or_default();
    lines.push(line);
    let start = lines.len().saturating_sub(BOOT_LOG_KEEP);
    let _ = std::fs::write(&file, lines[start..].concat());
}

/// 清除 WebView 全部浏览数据(缓存、存储、Cookie)。Windows 的 ClearBrowsingDataAll
/// 为异步完成,留出短暂等待再返回,降低前端随即重载撞上半清理状态的概率。
fn clear_webview_data(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.clear_all_browsing_data().map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(500));
    Ok(())
}

/// 前端启动失败时上报:计数 +1、落盘日志,返回本轮应执行的自愈动作。
/// 动作 "clear-data" 返回时浏览数据已清理完毕,前端直接重载即可。
#[tauri::command]
pub fn report_boot_failure(
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
    stage: String,
    detail: String,
) -> Result<String, String> {
    ensure_main(&window)?;
    let mut bs = read_boot_state(&state);
    bs.failures += 1;
    bs.last_stage = stage.chars().take(120).collect();
    bs.last_detail = detail.chars().take(BOOT_DETAIL_MAX).collect();
    bs.last_at = now_millis();
    let _ = write_boot_state(&state, &bs);
    append_boot_log(&state, &bs);
    println!("[boot] 启动失败 #{}: {}", bs.failures, bs.last_stage);
    let action = if bs.failures == 1 {
        "reload"
    } else if bs.failures == 2 {
        if let Err(e) = clear_webview_data(&window) {
            println!("[boot] 清理浏览数据失败: {e}");
        } else {
            println!("[boot] 已清理 WebView 浏览数据,指示前端重载");
        }
        "clear-data"
    } else {
        "give-up"
    };
    Ok(action.into())
}

/// 前端启动成功(完成初始化、界面可用):连续失败计数清零
#[tauri::command]
pub fn report_boot_success(state: State<'_, AppState>, window: tauri::WebviewWindow) -> Result<(), String> {
    ensure_main(&window)?;
    if read_boot_state(&state).failures != 0 {
        println!("[boot] 启动成功,失败计数清零");
        reset_boot_state(&state);
    }
    Ok(())
}

/// 手动急救:清除 WebView 浏览数据(设置页「清除浏览器缓存」)。应用数据
/// (app.json、站点)独立于 WebView 用户数据,不受影响;完成后由前端重载。
#[tauri::command]
pub fn repair_webview_data(window: tauri::WebviewWindow) -> Result<(), String> {
    ensure_main(&window)?;
    clear_webview_data(&window)
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
