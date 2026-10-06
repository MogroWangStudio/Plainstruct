/** 事件名 -- 与 src/ipc/events.ts 逐行镜像 */
pub const SYNC_PROGRESS: &str = "plainstruct://sync-progress";
pub const UPDATE_PROGRESS: &str = "plainstruct://update-progress";
pub const PUBLISH_LOG: &str = "plainstruct://publish-log";
/// 关窗请求转发事件(仅非 macOS 使用;macOS 关窗即隐藏,不转发)
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub const CLOSE_REQUESTED: &str = "plainstruct://close-requested";
/// 构建完成通知独立预览窗口原位刷新(仅前端 emit/listen,Rust 侧作常量镜像)
#[allow(dead_code)]
pub const PREVIEW_REBUILT: &str = "plainstruct://preview-rebuilt";
/// 预览窗口请求主窗口立即重新构建(仅前端 emit/listen,Rust 侧作常量镜像)
#[allow(dead_code)]
pub const PREVIEW_BUILD_REQUESTED: &str = "plainstruct://preview-build-requested";
