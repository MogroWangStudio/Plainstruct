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

/// 系统通知(发布成功 / Pages 构建完成):标题与正文由前端给定。
/// 错误直接返回文本,前端落入发布日志 —— 不静默吞掉。
/// - macOS 走现代 UNUserNotificationCenter(先请求授权再投递;依赖里的旧
///   NSUserNotification API 在新系统上会被静默丢弃,这就是此前不弹的根因);
/// - Windows 免安装包没有开始菜单快捷方式,系统会静默丢弃未注册 AUMID 的
///   toast —— 用系统自带 PowerShell 的 AUMID 兜底保证可见;
/// - Linux 走 notify-rust(libnotify)。
#[tauri::command]
pub async fn system_notify(window: tauri::WebviewWindow, title: String, body: String) -> Result<(), String> {
    ensure_main(&window)?;
    #[cfg(target_os = "macos")]
    {
        let _ = &title;
        let _ = &body;
        mac_notify(title, body)
            .await
            .map_err(|e| format!("系统通知任务失败: {e}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        desktop_notify(&title, &body)
    }
}

/// macOS:现代通知中心 —— 请求授权(首次弹系统授权框)后投递
#[cfg(target_os = "macos")]
async fn mac_notify(title: String, body: String) -> Result<(), String> {
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationRequest,
        UNNotificationSound, UNUserNotificationCenter,
    };
    use std::sync::mpsc;

    tauri::async_runtime::spawn_blocking(move || {
        let center = unsafe { UNUserNotificationCenter::currentNotificationCenter() };

        // 授权:首次使用时系统弹授权框,等待用户选择(最多 2 分钟)
        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        let handler = block2::RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            if !granted.as_bool() {
                let _ = tx.send(Err("系统通知权限未授予(系统设置 → 通知 → Plainstruct)".into()));
            }
        });
        unsafe {
            center.requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                &handler,
            );
        }
        match rx.recv_timeout(std::time::Duration::from_secs(120)) {
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err("系统通知授权超时(未响应系统授权框)".into()),
            Ok(Ok(())) => {}
        }

        // 投递
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&title));
        content.setBody(&NSString::from_str(&body));
        let sound = unsafe { UNNotificationSound::defaultSound() };
        content.setSound(Some(&sound));
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str("plainstruct-publish"),
            &content,
            None,
        );
        unsafe {
            center.addNotificationRequest_withCompletionHandler(&request, None);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Windows / Linux:notify-rust(Windows toast 经 AUMID 兜底,见上)
#[cfg(not(target_os = "macos"))]
fn desktop_notify(title: &str, body: &str) -> Result<(), String> {
    let mut n = notify_rust::Notification::new();
    n.summary(title).body(body);
    // PowerShell 的系统 AUMID:免安装 exe 无开始菜单快捷方式,未注册 AUMID
    // 的 toast 被系统静默丢弃 —— 借系统组件身份保证通知可见
    #[cfg(windows)]
    {
        const POWERSHELL_AUMID: &str = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
        n.app_id(POWERSHELL_AUMID);
    }
    n.show().map(|_| ()).map_err(|e| format!("发送系统通知失败: {e}"))
}
