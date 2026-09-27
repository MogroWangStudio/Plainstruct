/** 应用入口:插件、site:// 协议、命令注册 */
mod commands;
mod events;
mod fsutil;
mod state;

use std::borrow::Cow;

use tauri::http::{Request, Response, StatusCode};
use tauri::Manager;
use tauri::UriSchemeContext;

use state::AppState;

/* ---------- site:// 自定义协议:当前站点根目录的静态文件服务 ---------- */

fn mime_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "md" => "text/markdown; charset=utf-8",
        "txt" => "text/plain; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "map" => "application/json",
        _ => "application/octet-stream",
    }
}

/// site:// 页面的内容安全策略:允许同站与 https 外链资源,禁止向外部发起
/// fetch/WebSocket(connect-src),防止构建产物中的不可信脚本外带数据。
const SITE_CSP: &str = "default-src 'self' site:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src * data: site:; font-src * data: https:; connect-src 'self' site:; object-src 'none'; base-uri 'none'";

fn serve_response(status: StatusCode, mime: &str, body: Vec<u8>) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .header("Content-Security-Policy", SITE_CSP)
        .body(Cow::Owned(body))
        .unwrap()
}

fn handle_site<R: tauri::Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let app = ctx.app_handle();
    let state = app.state::<AppState>();
    let root = match state.site_root.lock() {
        Ok(guard) => match guard.clone() {
            Some(root) => root,
            None => {
                return serve_response(StatusCode::NOT_FOUND, "text/plain; charset=utf-8", b"no site open".to_vec())
            }
        },
        Err(_) => return serve_response(StatusCode::INTERNAL_SERVER_ERROR, "text/plain; charset=utf-8", Vec::new()),
    };

    let raw = request.uri().path();
    let decoded = percent_encoding::percent_decode_str(raw).decode_utf8_lossy().to_string();
    let mut rel = decoded.trim_start_matches('/').trim_end_matches('/').to_string();
    if rel.is_empty() {
        rel = "build/index.html".into();
    }

    // 拒绝隐藏文件/目录(以 . 开头的路径段):.plainstruct 存放站点配置(可能含
    // GitHub Token),不应通过预览协议暴露给构建产物中的不可信脚本。
    // 唯一例外:.plainstruct/assets/ 的顶层文件(站点 Logo 等图片,不含敏感数据),
    // 站点设置页需要在应用内预览 Logo。
    let hidden = rel.split('/').any(|seg| seg.starts_with('.'));
    let rest = rel.strip_prefix(".plainstruct/assets/").map(|r| r.trim_start_matches('/')).unwrap_or("");
    let allowed_hidden = !rest.is_empty() && !rest.contains('/');
    if hidden && !allowed_hidden {
        return serve_response(StatusCode::FORBIDDEN, "text/plain; charset=utf-8", b"forbidden".to_vec());
    }

    let full = match fsutil::safe_join(&root, &rel) {
        Ok(p) => p,
        Err(e) => return serve_response(StatusCode::FORBIDDEN, "text/plain; charset=utf-8", e.into_bytes()),
    };

    let target = if full.is_dir() {
        full.join("index.html")
    } else {
        full
    };

    if !target.is_file() {
        return serve_response(StatusCode::NOT_FOUND, "text/plain; charset=utf-8", format!("not found: {rel}").into_bytes());
    }

    match std::fs::read(&target) {
        Ok(bytes) => {
            let mime = mime_for(&target.to_string_lossy());
            serve_response(StatusCode::OK, mime, bytes)
        }
        Err(_) => serve_response(StatusCode::NOT_FOUND, "text/plain; charset=utf-8", Vec::new()),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::default())
        .register_uri_scheme_protocol("site", handle_site)
        .invoke_handler(tauri::generate_handler![
            // 应用
            commands::get_bootstrap,
            commands::save_settings,
            commands::log_frontend,
            commands::check_update,
            commands::set_data_dir,
            commands::update_download,
            // 站点
            commands::create_site,
            commands::open_site,
            commands::close_site,
            commands::get_site_root,
            commands::read_site_config,
            commands::save_site_config,
            commands::set_site_logo,
            commands::remove_site_logo,
            // 内容
            commands::list_tree,
            commands::save_doc_order,
            commands::read_docs,
            commands::save_doc,
            commands::create_doc,
            commands::create_folder,
            commands::rename_item,
            commands::move_item,
            commands::delete_item,
            commands::import_files,
            commands::import_site_images,
            // 构建
            commands::clear_build,
            commands::write_build_files,
            commands::copy_paths,
            // 主题
            commands::list_custom_themes,
            commands::read_theme_files,
            commands::save_theme_files,
            commands::create_custom_theme,
            commands::delete_theme,
            commands::import_theme_zip,
            commands::export_theme_zip,
            // GitHub
            commands::github_read_config,
            commands::github_save_config,
            commands::github_verify,
            commands::github_preflight,
            commands::github_pages_status,
            commands::github_sync,
            // 系统
            commands::open_path,
            commands::open_data_dir,
            commands::open_external,
            commands::reload_webview,
        ])
        .setup(|app| {
            let state = app.state::<AppState>();
            // 应用正常启动即说明没有更新待执行:清掉上次更新残留的任务目录,
            // 「目录内存在向导脚本」仅表示「已下载更新、等待退出后执行」
            let _ = std::fs::remove_dir_all(commands::github::update_dir());
            // 便携版策略:默认数据目录为可执行文件所在根目录下的 data/,数据随程序
            // 一起迁移;exe 所在目录不可写(如安装进 Program Files)时回退系统 AppData
            let portable = std::env::current_exe().ok().and_then(|exe| {
                let dir = exe.parent()?.join("data");
                std::fs::create_dir_all(&dir).ok()?;
                Some(dir)
            });
            let default_dir = match portable {
                Some(dir) => dir,
                None => app.path().app_data_dir().unwrap_or_default(),
            };
            // 数据目录引导:默认目录 app.json 记录的自定义位置(目录存在时启用,
            // 不可用则回退默认目录,默认目录中仍保留迁移前的数据备份)
            let mut data_dir = default_dir.clone();
            if let Some(custom) = commands::app::read_app_data_at(&default_dir).custom_data_dir {
                if !custom.is_empty() && std::path::Path::new(&custom).is_dir() {
                    data_dir = std::path::PathBuf::from(custom);
                }
            }
            if let Ok(mut guard) = state.default_data_dir.lock() {
                *guard = default_dir;
            }
            if let Ok(mut guard) = state.app_data_dir.lock() {
                *guard = data_dir;
            }
            // 平台窗口装饰:macOS 保留原生圆角与红绿灯(conf 里 titleBarStyle Overlay + hiddenTitle),
            // 其余平台维持无边框自绘标题栏;窗口初始隐藏,装饰调整完成后再显示,避免启动闪烁
            if let Some(win) = app.get_webview_window("main") {
                #[cfg(not(target_os = "macos"))]
                let _ = win.set_decorations(false);
                let _ = win.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running plainstruct");

    // 应用退出后:若用户已下载好更新,拉起平台对应的更新向导
    // (Windows:PowerShell 更新窗体;macOS:终端脚本,含按需的隔离修复)
    spawn_update_helper_if_pending();
}

/// 存在已下载的更新任务时,以独立进程拉起更新向导(与应用退出解耦)
fn spawn_update_helper_if_pending() {
    let dir = commands::github::update_dir();
    if !dir.exists() {
        return;
    }
    #[cfg(target_os = "windows")]
    {
        let script = dir.join("update-helper.ps1");
        if script.exists() {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    &script.to_string_lossy(),
                ])
                // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP:独立于已退出应用的作业
                .creation_flags(0x0000_0008 | 0x0000_0200)
                .spawn();
        }
    }
    #[cfg(target_os = "macos")]
    {
        let script = dir.join("update-helper.command");
        if script.exists() {
            let _ = std::process::Command::new("open")
                .args(["-a", "Terminal", &script.to_string_lossy()])
                .spawn();
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let _ = dir;
}
