/** 全局状态:当前站点根目录、应用数据目录、共享 HTTP 客户端、局域网同步服务 */
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::lan::LanService;

pub struct AppState {
    pub site_root: Mutex<Option<PathBuf>>,
    /// 数据目录(当前生效:自定义目录或默认目录)
    pub app_data_dir: Mutex<PathBuf>,
    /// 默认数据目录(便携 data/ 或回退 AppData);自定义目录的引导指针存于其 app.json
    pub default_data_dir: Mutex<PathBuf>,
    pub http: reqwest::Client,
    /// 局域网同步服务(None = 未开启)
    pub lan: Mutex<Option<Arc<LanService>>>,
    /// 更新下载控制标志:暂停(下载循环看到后收尾返回)与取消(清理残留后中止)
    pub update_pause: AtomicBool,
    pub update_cancel: AtomicBool,
    /// 进行中的更新包文件名(取消时据此删除半成品,任务文件在完成后才落盘)
    pub update_asset: Mutex<Option<String>>,
    /// 后台发布任务占用的站点根:发布期间切站/关站后,构建落盘与产物收集
    /// 仍指向发起站点;发布结束(或取消)后清空
    pub publish_root: Mutex<Option<PathBuf>>,
    /// 发布取消标志:上传循环与各步骤间轮询,ref 更新后的取消会回退站点引用
    pub publish_cancel: AtomicBool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            site_root: Mutex::new(None),
            app_data_dir: Mutex::new(PathBuf::new()),
            default_data_dir: Mutex::new(PathBuf::new()),
            http: reqwest::Client::builder()
                .user_agent("Plainstruct")
                // 必须带超时:否则同步期间单个挂起的请求会让流程无限等待
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(120))
                .build()
                .expect("failed to build http client"),
            lan: Mutex::new(None),
            update_pause: AtomicBool::new(false),
            update_cancel: AtomicBool::new(false),
            update_asset: Mutex::new(None),
            publish_root: Mutex::new(None),
            publish_cancel: AtomicBool::new(false),
        }
    }
}

/// 仅允许主窗口调用命令。预览窗口(site-preview)加载的构建产物属不可信内容,
/// 而 Tauri 自定义命令不受 capabilities 门控,必须在命令入口显式拦截。
pub fn ensure_main(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("forbidden-window".into())
    }
}

impl AppState {
    pub fn site_root(&self) -> Result<PathBuf, String> {
        self.site_root
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or_else(|| "no-site-open".to_string())
    }

    /// 后台发布任务占用的站点根(无任务时 None)
    pub fn publish_root(&self) -> Option<PathBuf> {
        self.publish_root.lock().map(|p| p.clone()).unwrap_or(None)
    }

    pub fn app_data(&self) -> PathBuf {
        self.app_data_dir.lock().map(|p| p.clone()).unwrap_or_default()
    }

    pub fn default_data_dir(&self) -> PathBuf {
        self.default_data_dir.lock().map(|p| p.clone()).unwrap_or_default()
    }
}
