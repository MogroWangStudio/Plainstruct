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
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "heic" => "image/heic",
        "heif" => "image/heif",
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

/// site:// 页面的内容安全策略:资源加载全面放开(http/https 外链图片、样式、字体、
/// 媒体与 iframe 内嵌均可展示,含 data:/blob:),仅保留两条底线 ——
/// 禁止向外部发起 fetch/WebSocket(connect-src 限同站),禁止 object/embed 插件与
/// base 劫持;构建产物中的不可信脚本无法借预览窗口外带数据。
const SITE_CSP: &str = "default-src * site: data: blob:; script-src 'self' site: 'unsafe-inline' 'unsafe-eval' http: https:; style-src * site: 'unsafe-inline' data: blob:; img-src * site: data: blob:; media-src * site: data: blob:; font-src * site: data:; connect-src 'self' site:; frame-src * site: data: blob:; worker-src * site: blob:; object-src 'none'; base-uri 'none'; form-action 'self' site:";

/// 预览注入脚本:独立预览窗口的壳层经 postMessage 激活后提供触摸镜像与
/// 安卓侧滑返回,对编辑器内嵌预览保持沉默。脚本说明见 preview_shim.js。
const PREVIEW_SHIM: &str = include_str!("preview_shim.js");

/// 向 HTML 响应注入预览脚本:插在 </body> 前(大小写不敏感地取最后一处),
/// 找不到锚点时整体追加;已含注入标记的页面原样返回,保证幂等。
/// no_anim 时在脚本前先置标记,shim 据此在首帧绘制前停用页面进场/加载动画
/// —— 对 site:// 的所有预览窗口生效(独立窗口、构建页与编辑器相关 iframe)。
/// 非 UTF-8 的响应不注入(构建产物 HTML 均为 UTF-8,此分支只是兜底)。
fn inject_preview_shim(bytes: Vec<u8>, no_anim: bool) -> Vec<u8> {
    let text = match std::str::from_utf8(&bytes) {
        Ok(t) => t,
        Err(_) => return bytes,
    };
    if text.contains("__psPreviewShim") {
        return bytes;
    }
    let flag = if no_anim { "<script>window.__psNoAnim=true;</script>" } else { "" };
    let snippet = format!("{flag}<script>{PREVIEW_SHIM}</script>");
    // to_ascii_lowercase 保持字节长度不变,小写副本里的下标可直接用于原文本
    let anchor = text.to_ascii_lowercase().rfind("</body>");
    let mut out = Vec::with_capacity(bytes.len() + snippet.len());
    match anchor {
        Some(at) => {
            out.extend_from_slice(&bytes[..at]);
            out.extend_from_slice(snippet.as_bytes());
            out.extend_from_slice(&bytes[at..]);
        }
        None => {
            out.extend_from_slice(&bytes);
            out.extend_from_slice(snippet.as_bytes());
        }
    }
    out
}

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
            // HTML 页面注入预览脚本(幂等);其余类型原样返回
            let body = if mime.starts_with("text/html") {
                inject_preview_shim(bytes, commands::app::refresh_anim_disabled(&state))
            } else {
                bytes
            };
            serve_response(StatusCode::OK, mime, body)
        }
        Err(_) => serve_response(StatusCode::NOT_FOUND, "text/plain; charset=utf-8", Vec::new()),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 二次启动:macOS 关窗后进程保留、Windows 退出也存在短暂窗口期,
            // 此时旧实例的窗口可能已关闭 —— 把主窗口重新带回前台,
            // 避免「关闭后立即重启软件看不到任何界面」
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
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
            commands::report_boot_failure,
            commands::report_boot_success,
            commands::repair_webview_data,
            commands::check_update,
            commands::set_data_dir,
            commands::update_download,
            commands::update_pause,
            commands::update_cancel,
            commands::update_restart_and_install,
            // 站点
            commands::create_site,
            commands::open_site,
            commands::close_site,
            commands::get_site_root,
            commands::read_site_config,
            commands::get_site_info,
            commands::save_site_config,
            commands::set_site_logo,
            commands::remove_site_logo,
            commands::set_site_favicon,
            commands::remove_site_favicon,
            // 站点插件
            commands::import_site_plugin,
            commands::delete_site_plugin,
            commands::read_site_plugin_files,
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
            commands::import_site_image_to,
            commands::import_site_asset_data,
            commands::import_site_assets,
            commands::read_folder_configs,
            commands::write_folder_config,
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
        .on_window_event(|window, event| {
            // macOS 关窗惯例:主窗口隐藏而非销毁 —— 保留 WebView,单实例
            // 回调把窗口带回前台时界面完整;否则销毁后只剩空壳窗口。
            // 应用级退出(Cmd+Q / Dock 退出)不走窗口关闭,不受影响。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(target_os = "macos")]
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // 非 macOS:关窗决策交给前端 —— 有未保存修改时弹确认,
                // 否则前端调用 destroy 直接关闭。自绘标题栏按钮与任务栏关闭
                // 都会走到这里,行为一致。
                #[cfg(not(target_os = "macos"))]
                if window.label() == "main" {
                    api.prevent_close();
                    use tauri::Emitter;
                    let _ = window.emit(crate::events::CLOSE_REQUESTED, ());
                }
            }
            let _ = window; // 其余事件不处理
        })
        .setup(|app| {
            let state = app.state::<AppState>();
            // 清理更新任务残留:任务版本已不新于当前(装上了/过期)或包缺失时清空;
            // 仍有待安装任务则保留,前端在设置页显示「重启并更新」。
            // 更新向导改由用户点击按钮显式拉起,退出应用不再自动执行更新。
            commands::github::cleanup_update_task(env!("CARGO_PKG_VERSION"));
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
            // 启动自愈预防(必须在数据目录初始化之后,否则读到空路径永远失效):
            // 上一轮已连续失败 ≥2 次(自动修复档已用尽)时,本轮在页面加载前先清
            // 一次 WebView 浏览数据,给应用一个干净环境,随后重置计数重新观察;
            // 若仍失败,前端上报会重新走分级自愈
            let boot = commands::app::read_boot_state(&state);
            if boot.failures >= 2 {
                if let Some(win) = app.get_webview_window("main") {
                    match win.clear_all_browsing_data() {
                        Ok(()) => println!("[boot] 检测到连续启动失败,已预清理 WebView 浏览数据"),
                        Err(e) => println!("[boot] 预清理浏览数据失败: {e}"),
                    }
                }
                commands::app::reset_boot_state(&state);
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
}
