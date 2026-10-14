/** 系统命令:打开路径/外链、刷新指定 webview、系统通知 */
use serde::{Deserialize, Serialize};
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
/// 通知按钮(Windows toast action):label 为按钮文案,arg 为激活参数
/// (plainstruct://publish 回跳应用,或 https:// 直开浏览器)
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NotifyAction {
    pub label: String,
    pub arg: String,
}

/// - macOS 走现代 UNUserNotificationCenter(先请求授权再投递;依赖里的旧
///   NSUserNotification API 在新系统上会被静默丢弃,这就是此前不弹的根因);
/// - Windows 走 ToastNotification(XML 可带按钮),身份用启动时注册的 AUMID
///   (注册表注册,通知显示为 Plainstruct 本身);
/// - Linux 走 notify-rust(libnotify,无按钮)。
#[tauri::command]
pub async fn system_notify(
    window: tauri::WebviewWindow,
    title: String,
    body: String,
    actions: Option<Vec<NotifyAction>>,
) -> Result<(), String> {
    ensure_main(&window)?;
    let actions = actions.unwrap_or_default();
    #[cfg(target_os = "macos")]
    {
        let _ = &actions;
        mac_notify(title, body)
            .await
            .map_err(|e| format!("系统通知任务失败: {e}"))
    }
    #[cfg(windows)]
    {
        let _ = &title;
        tauri::async_runtime::spawn_blocking(move || {
            let aumid = AUMID.to_string();
            show_windows_toast(&aumid, &title, &body, &actions)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    {
        let _ = &actions;
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
        let center = UNUserNotificationCenter::currentNotificationCenter();

        // 授权:首次使用时系统弹授权框,等待用户选择(最多 2 分钟)
        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        let handler = block2::RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            if !granted.as_bool() {
                let _ = tx.send(Err("系统通知权限未授予(系统设置 → 通知 → Plainstruct)".into()));
            }
        });
        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &handler,
        );
        match rx.recv_timeout(std::time::Duration::from_secs(120)) {
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err("系统通知授权超时(未响应系统授权框)".into()),
            Ok(Ok(())) => {}
        }

        // 投递
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&title));
        content.setBody(&NSString::from_str(&body));
        let sound = UNNotificationSound::defaultSound();
        content.setSound(Some(&sound));
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str("plainstruct-publish"),
            &content,
            None,
        );
        center.addNotificationRequest_withCompletionHandler(&request, None);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Windows/Linux:notify-rust(libnotify;仅非 Windows 平台 —— Windows 走上方 toast)
#[cfg(all(not(target_os = "macos"), not(windows)))]
fn desktop_notify(title: &str, body: &str) -> Result<(), String> {
    let mut n = notify_rust::Notification::new();
    n.summary(title).body(body);
    n.show().map(|_| ()).map_err(|e| format!("发送系统通知失败: {e}"))
}

/* ---------- Windows:通知身份注册与按钮 toast ---------- */

#[cfg(windows)]
const AUMID: &str = "com.mws.plainstruct";
#[cfg(windows)]
const PROTOCOL: &str = "plainstruct";

/// 启动时注册通知身份与协议(HKCU,无需管理员):
/// - AppUserModelId\<AUMID>:DisplayName + IconUri —— 非打包应用没有开始菜单
///   快捷方式,不注册则系统丢弃 toast 或显示为其他身份;
/// - plainstruct:// 协议指向当前 exe —— 通知按钮经协议回跳应用。
#[cfg(windows)]
pub fn ensure_windows_notification_identity(app: &tauri::AppHandle) {
    let run = || -> Result<(), String> {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let display = app
            .config()
            .product_name
            .clone()
            .unwrap_or_else(|| "Plainstruct".to_string());
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        // 图标落盘(通知中心显示用):内容变化才重写
        let local = std::env::var("LOCALAPPDATA").map_err(|_| "缺少 LOCALAPPDATA".to_string())?;
        let dir = std::path::Path::new(&local).join("Plainstruct");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let icon_path = dir.join("app.ico");
        let icon_bytes = include_bytes!("../../icons/icon.ico");
        let stale = std::fs::read(&icon_path)
            .map(|b| b.as_slice() != icon_bytes.as_slice())
            .unwrap_or(true);
        if stale {
            std::fs::write(&icon_path, icon_bytes).map_err(|e| e.to_string())?;
        }

        let key = hkcu
            .create_subkey(format!(r"Software\Classes\AppUserModelId\{}", AUMID))
            .map_err(|e| e.to_string())?
            .0;
        let icon_uri = icon_path.display().to_string();
        key.set_value("DisplayName", &display.as_str()).map_err(|e| e.to_string())?;
        key.set_value("IconUri", &icon_uri.as_str()).map_err(|e| e.to_string())?;

        let exe = tauri::utils::platform::current_exe().map_err(|e| e.to_string())?;
        let command = format!("\"{}\" \"%1\"", exe.display());
        let proto = hkcu
            .create_subkey(format!(r"Software\Classes\{}", PROTOCOL))
            .map_err(|e| e.to_string())?
            .0;
        let url_protocol = "";
        proto.set_value("URL Protocol", &url_protocol).map_err(|e| e.to_string())?;
        let cmd = hkcu
            .create_subkey(format!(r"Software\Classes\{}\shell\open\command", PROTOCOL))
            .map_err(|e| e.to_string())?
            .0;
        cmd.set_value("", &command.as_str()).map_err(|e| e.to_string())?;
        Ok(())
    };
    if let Err(e) = run() {
        eprintln!("[plainstruct] 注册 Windows 通知身份失败: {e}");
    }
}

/// XML 文本转义(toast XML 中不能出现裸 & < > " ')
#[cfg(windows)]
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Windows toast:协议激活(点击通知体/按钮 → plainstruct:// 或 https://)
#[cfg(windows)]
fn show_windows_toast(aumid: &str, title: &str, body: &str, actions: &[NotifyAction]) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

    let launch = actions.first().map(|a| a.arg.as_str()).unwrap_or("plainstruct://publish");
    let mut xml = format!(
        r#"<toast activationType="protocol" launch="{}"><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text></binding></visual>"#,
        xml_escape(launch),
        xml_escape(title),
        xml_escape(body),
    );
    if !actions.is_empty() {
        xml.push_str("<actions>");
        for a in actions {
            xml.push_str(&format!(
                r#"<action content="{}" arguments="{}" activationType="protocol"/>"#,
                xml_escape(&a.label),
                xml_escape(&a.arg),
            ));
        }
        xml.push_str("</actions>");
    }
    xml.push_str("</toast>");

    let doc = XmlDocument::new().map_err(|e| e.to_string())?;
    doc.LoadXml(&HSTRING::from(xml)).map_err(|e| e.to_string())?;
    let toast = ToastNotification::CreateToastNotification(&doc).map_err(|e| e.to_string())?;
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(aumid))
        .map_err(|e| e.to_string())?;
    notifier.Show(&toast).map_err(|e| e.to_string())
}
