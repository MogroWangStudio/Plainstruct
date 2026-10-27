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
/// 局域网同步:收到推送计划(等待用户接受/拒绝)
#[allow(dead_code)]
pub const LAN_INCOMING: &str = "plainstruct://lan-incoming";
/// 局域网同步:接收进度 {direction, received, total}
#[allow(dead_code)]
pub const LAN_PROGRESS: &str = "plainstruct://lan-progress";
/// 局域网同步:对方设备列表失效(session 校验失败,提示重新扫描)
#[allow(dead_code)]
pub const LAN_REJECTED: &str = "plainstruct://lan-rejected";
