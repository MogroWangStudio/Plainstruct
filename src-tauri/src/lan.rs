/** 局域网同步:设备发现(UDP 广播)与站点传输(手写 HTTP/1.1 over TCP)。
 *
 * 协议要点(两端对称,桌面与安卓同一实现):
 * - 发现:UDP 端口 44223,请求 magic "PLAINSTRUCT-LAN-V1 DISCOVER"(随机 token 回显校验),
 *   回应 JSON {app, protocol, token, session, name, platform, port, trusted, sites};
 *   发送方除受限广播外向每张非回环 IPv4 网卡的子网定向广播(部分路由器会丢弃受限广播)。
 * - 传输:HTTP 端口由系统分配,路径前缀 /plainstruct-lan/v1/,所有请求须携带
 *   ?session=(服务每次启动生成的握手值,仅防误连,不加密 —— 局域网明文传输)。
 * - 推送两阶段:PUT /plan(计划,信任网络自动接受,否则等用户决定 150s)→
 *   PUT /data?plan=token(站点包,接收端先备份再写入,模式由接收方决定)。
 * - 拉取:GET /site?name=(对方须开启「信任此局域网」)。
 * - 站点包:单个 JSON 文档 {format, version, name, files: {相对路径: {text|b64}}},
 *   排除 build/ 产物与 .plainstruct/github.json(含 Token,不随同步离开设备)。 */

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::Manager;

use crate::events;
use crate::state::AppState;

pub const LAN_PROTOCOL: u32 = 1;
pub const DISCOVERY_PORT: u16 = 44223;
const DISCOVERY_MAGIC: &str = "PLAINSTRUCT-LAN-V1 DISCOVER ";
const HTTP_PREFIX: &str = "/plainstruct-lan/v1/";
/// 站点包与推送数据的体积上限
const BODY_LIMIT: u64 = 256 * 1024 * 1024;
/// 非信任网络下等待用户决定推送计划的时长
const DECIDE_WAIT: Duration = Duration::from_secs(150);
const SITE_BUNDLE_FORMAT: &str = "plainstruct-site-bundle";
const SITE_BUNDLE_VERSION: u32 = 1;
/// 接收覆盖前的自动备份保留份数
const BACKUP_KEEP: usize = 5;

/* ---------- 数据结构 ---------- */

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LanSiteBrief {
    pub name: String,
    pub site_type: String,
    pub size_bytes: u64,
}

#[derive(Serialize, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanPeer {
    pub ip: String,
    pub port: u16,
    pub session: String,
    pub name: String,
    pub platform: String,
    pub trusted: bool,
    pub sites: Vec<LanSiteBrief>,
}

/// 收到的推送计划(第一阶段),交前端弹确认
#[derive(Serialize, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanPushPlan {
    pub device: String,
    pub device_platform: String,
    pub site_name: String,
    pub size_bytes: u64,
    pub file_count: u64,
}

struct PendingPlan {
    responder: Sender<Option<(String, String)>>,
}

/// 随机 token:时间 + 计数器 xorshift(握手混淆值,非密钥)
fn random_token() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut x = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
        ^ std::process::id() as u64
        ^ COUNTER.fetch_add(0x9e37_79b9_7f4a_7c15, Ordering::Relaxed);
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    format!("{x:032x}{:08x}", (x >> 32) as u32)
}

pub fn platform_name() -> &'static str {
    if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else {
        "unknown"
    }
}

/* ---------- 服务 ---------- */

pub struct LanService {
    pub app: tauri::AppHandle,
    pub session: String,
    pub http_port: u16,
    device_name: Mutex<String>,
    trusted: AtomicBool,
    running: AtomicBool,
    /// 待处理的推送计划(同一会话至多一个)
    pending: Mutex<Option<PendingPlan>>,
    /// 最近一次接受的计划 token 与落盘模式,data 阶段按此校验与落盘
    decision: Mutex<Option<(String, String)>>,
}

impl LanService {
    fn new(app: tauri::AppHandle, http_port: u16, device_name: String, trusted: bool) -> Self {
        Self {
            app,
            session: random_token(),
            http_port,
            device_name: Mutex::new(device_name),
            trusted: AtomicBool::new(trusted),
            running: AtomicBool::new(true),
            pending: Mutex::new(None),
            decision: Mutex::new(None),
        }
    }

    pub fn is_trusted(&self) -> bool {
        self.trusted.load(Ordering::Relaxed)
    }

    pub fn set_trusted(&self, trusted: bool) {
        self.trusted.store(trusted, Ordering::Relaxed);
    }

    pub fn set_device_name(&self, name: String) {
        if let Ok(mut guard) = self.device_name.lock() {
            *guard = name;
        }
    }

    pub fn device_name(&self) -> String {
        self.device_name.lock().map(|n| n.clone()).unwrap_or_default()
    }
}

pub fn sites_dir(state: &AppState) -> PathBuf {
    state.app_data().join("sites")
}

/// 数据目录 sites/ 下的本地站点列表(LAN 广播、拉取白名单与移动端站点库共用)
pub fn local_sites(state: &AppState) -> Vec<LanSiteBrief> {
    let dir = sites_dir(state);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut rows: Vec<LanSiteBrief> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let cfg = crate::commands::site::read_site_config_file(&e.path()).ok()?;
            Some(LanSiteBrief {
                name,
                site_type: cfg.site_type.unwrap_or_else(|| "docs".into()),
                size_bytes: crate::commands::build::dir_size(&e.path()),
            })
        })
        .collect();
    rows.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    rows
}

/* ---------- 启动 / 停止 ---------- */

pub fn start_service(
    app: &tauri::AppHandle,
    state: &AppState,
    device_name: String,
    trusted: bool,
) -> Result<u16, String> {
    let mut guard = state.lan.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.as_ref() {
        // 已在运行:仅刷新元数据
        existing.set_device_name(device_name);
        existing.set_trusted(trusted);
        return Ok(existing.http_port);
    }
    let listener = TcpListener::bind(("0.0.0.0", 0)).map_err(|e| format!("lan-bind: {e}"))?;
    let service = Arc::new(LanService::new(
        app.clone(),
        listener.local_addr().map_err(|e| e.to_string())?.port(),
        device_name,
        trusted,
    ));

    // HTTP 服务线程:每连接一线程(局域网设备数量级,无需异步运行时)
    {
        let svc = service.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                if !svc.running.load(Ordering::Relaxed) {
                    break;
                }
                match stream {
                    Ok(stream) => {
                        let svc = svc.clone();
                        std::thread::spawn(move || handle_connection(svc, stream));
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // 发现线程:常驻回应 UDP 探测(端口被占时仅失去被动可见,主动传输不受影响)
    {
        let svc = service.clone();
        std::thread::spawn(move || discovery_loop(svc));
    }

    guard.replace(service.clone());
    Ok(service.http_port)
}

pub fn stop_service(state: &AppState) -> Result<(), String> {
    let mut guard = state.lan.lock().map_err(|e| e.to_string())?;
    if let Some(svc) = guard.take() {
        svc.running.store(false, Ordering::Relaxed);
        // 唤醒阻塞在 accept 的线程;发现线程读超时自退
        let _ = TcpStream::connect(("127.0.0.1", svc.http_port));
    }
    Ok(())
}

/* ---------- 发现 ---------- */

fn discovery_loop(svc: Arc<LanService>) {
    let socket = match UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)) {
        Ok(s) => s,
        Err(_) => return,
    };
    let _ = socket.set_read_timeout(Some(Duration::from_millis(500)));
    let mut buf = [0u8; 512];
    while svc.running.load(Ordering::Relaxed) {
        match socket.recv_from(&mut buf) {
            Ok((n, from)) => {
                let text = String::from_utf8_lossy(&buf[..n]);
                if let Some(token) = text.strip_prefix(DISCOVERY_MAGIC) {
                    let reply = discovery_reply(&svc, token.trim());
                    let _ = socket.send_to(reply.as_bytes(), from);
                }
            }
            Err(_) => continue,
        }
    }
}

fn discovery_reply(svc: &LanService, token: &str) -> String {
    let state = svc.app.state::<AppState>();
    let body = serde_json::json!({
        "app": "plainstruct",
        "protocol": LAN_PROTOCOL,
        "token": token,
        "session": svc.session,
        "name": svc.device_name(),
        "platform": platform_name(),
        "port": svc.http_port,
        "trusted": svc.is_trusted(),
        "sites": local_sites(&state),
    });
    body.to_string()
}

/// 从 UDP 回应包构造 peer(校验 app/protocol/token 回显;HTTP 端口取自回应体)
fn parse_peer(ip: IpAddr, packet: &str, expect_token: &str) -> Option<LanPeer> {
    let v: Value = serde_json::from_str(packet).ok()?;
    if v.get("app")?.as_str()? != "plainstruct" || v.get("protocol")?.as_u64()? != LAN_PROTOCOL as u64 {
        return None;
    }
    if v.get("token")?.as_str()? != expect_token {
        return None;
    }
    let sites = v
        .get("sites")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    Some(LanSiteBrief {
                        name: s.get("name")?.as_str()?.to_string(),
                        site_type: s.get("siteType").and_then(|t| t.as_str()).unwrap_or("docs").to_string(),
                        size_bytes: s.get("sizeBytes").and_then(|b| b.as_u64()).unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Some(LanPeer {
        ip: ip.to_string(),
        port: v.get("port")?.as_u64()? as u16,
        session: v.get("session")?.as_str()?.to_string(),
        name: v.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
        platform: v.get("platform").and_then(|p| p.as_str()).unwrap_or("").to_string(),
        trusted: v.get("trusted").and_then(|t| t.as_bool()).unwrap_or(false),
        sites,
    })
}

/// 广播发现:受限广播 + 各网卡子网定向广播 + 回环;900ms 窗口内收集回应
pub fn discover() -> Result<Vec<LanPeer>, String> {
    let socket = UdpSocket::bind(("0.0.0.0", 0)).map_err(|e| format!("lan-udp: {e}"))?;
    socket.set_broadcast(true).map_err(|e| e.to_string())?;
    let _ = socket.set_read_timeout(Some(Duration::from_millis(120)));

    let token = random_token()[..16].to_string();
    let packet = format!("{DISCOVERY_MAGIC}{token}");

    let mut targets: Vec<SocketAddr> = vec![
        "255.255.255.255:44223".parse().unwrap(),
        "127.0.0.1:44223".parse().unwrap(),
    ];
    if let Ok(ifs) = if_addrs::get_if_addrs() {
        for iface in ifs {
            if iface.is_loopback() {
                continue;
            }
            if let if_addrs::IfAddr::V4(v4) = iface.addr {
                let net = u32::from(v4.ip) & u32::from(v4.netmask);
                let bcast = Ipv4Addr::from(net | !u32::from(v4.netmask));
                targets.push(SocketAddr::from((IpAddr::V4(bcast), DISCOVERY_PORT)));
            }
        }
    }
    for t in &targets {
        let _ = socket.send_to(packet.as_bytes(), t);
    }

    // 窗口期收包,顺带重发(移动端 Wi-Fi 省电常丢首包)
    let deadline = std::time::Instant::now() + Duration::from_millis(900);
    let mut next_resend = std::time::Instant::now() + Duration::from_millis(300);
    let mut peers: Vec<LanPeer> = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        let now = std::time::Instant::now();
        if now >= deadline {
            break;
        }
        if now >= next_resend {
            next_resend += Duration::from_millis(300);
            for t in &targets {
                let _ = socket.send_to(packet.as_bytes(), t);
            }
        }
        match socket.recv_from(&mut buf) {
            Ok((n, from)) => {
                let text = String::from_utf8_lossy(&buf[..n]);
                if let Some(peer) = parse_peer(from.ip(), &text, &token) {
                    // 本机服务也会从回环收到自己的回应:按 session 去重
                    if !peers.iter().any(|p| p.session == peer.session && p.ip == peer.ip) {
                        peers.push(peer);
                    }
                }
            }
            Err(_) => continue,
        }
    }
    peers.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(peers)
}

/* ---------- 站点打包与写入 ---------- */

/// 文本类扩展名:站点包里直接以 UTF-8 传输,其余按 base64
fn is_text_ext(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("md" | "markdown" | "json" | "css" | "js" | "mjs" | "hbs" | "html" | "htm" | "txt" | "svg")
    )
}

/// 打包站点目录为站点包 JSON(排除 build/ 与 github.json),返回 (包, 文件数)
pub fn bundle_site(root: &Path) -> Result<(Value, u64), String> {
    let mut files = serde_json::Map::new();
    let mut count: u64 = 0;
    let walker = walkdir::WalkDir::new(root).sort_by_file_name();
    for entry in walker {
        let entry = entry.map_err(|e| format!("walk: {e}"))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = crate::fsutil::rel_posix(root, entry.path());
        // 构建产物可由接收端重建;GitHub 配置含 Token,绝不同步
        if rel == "build" || rel.starts_with("build/") || rel.starts_with(".plainstruct/github.json") {
            continue;
        }
        let bytes = std::fs::read(entry.path()).map_err(|e| format!("read {rel}: {e}"))?;
        count += 1;
        let item = if is_text_ext(entry.path()) {
            serde_json::json!({ "text": String::from_utf8_lossy(&bytes) })
        } else {
            serde_json::json!({ "b64": base64::engine::general_purpose::STANDARD.encode(&bytes) })
        };
        files.insert(rel, item);
    }
    let cfg = crate::commands::site::read_site_config_file(&root.to_path_buf())?;
    let bundle = serde_json::json!({
        "format": SITE_BUNDLE_FORMAT,
        "version": SITE_BUNDLE_VERSION,
        "name": cfg.name,
        "siteType": cfg.site_type.unwrap_or_else(|| "docs".into()),
        "files": Value::Object(files),
    });
    Ok((bundle, count))
}

/// 校验站点包结构:格式、版本与文件路径(拒绝绝对路径、.. 与隐藏文件)
fn bundle_shape_valid(bundle: &Value) -> bool {
    bundle.get("format").and_then(|f| f.as_str()) == Some(SITE_BUNDLE_FORMAT)
        && bundle.get("version").and_then(|v| v.as_u64()) == Some(SITE_BUNDLE_VERSION as u64)
        && bundle.get("files").and_then(|f| f.as_object()).map(|f| {
            f.keys().all(|k| {
                !k.is_empty()
                    && !k.starts_with('/')
                    && !k.split('/').any(|seg| seg == ".." || seg.starts_with('.'))
            })
        }) == Some(true)
}

/// 应用站点包:mode = replace(覆盖同名,先备份) / copy(自动改名)。
/// 返回实际落盘的站点目录名
pub fn apply_bundle(state: &AppState, bundle: &Value, mode: &str) -> Result<String, String> {
    if !bundle_shape_valid(bundle) {
        return Err("bad-bundle".into());
    }
    let files = bundle.get("files").and_then(|f| f.as_object()).ok_or("bad-bundle")?;
    let raw_name = bundle.get("name").and_then(|n| n.as_str()).unwrap_or("未命名站点");
    let name = crate::fsutil::safe_name(raw_name);
    let sites = sites_dir(state);
    std::fs::create_dir_all(&sites).map_err(|e| e.to_string())?;
    let target = sites.join(&name);

    // 站点包不含 github.json:覆盖时保留既有 Token 配置,避免接收端重新填写
    let existing_github = std::fs::read(target.join(".plainstruct").join("github.json")).ok();

    let final_dir = if mode == "replace" && target.join(".plainstruct").exists() {
        backup_site(state, &name)?;
        let _ = std::fs::remove_dir_all(&target);
        target
    } else if mode == "replace" {
        target
    } else {
        crate::fsutil::unique_path(&target)
    };
    std::fs::create_dir_all(&final_dir).map_err(|e| e.to_string())?;

    // site.json 最后写:open_site 以它作为「是素构站点」的判据,保证打开时文件已齐
    let mut config_json: Option<String> = None;
    for (rel, item) in files {
        let text = item.get("text").and_then(|t| t.as_str());
        let b64 = item.get("b64").and_then(|t| t.as_str());
        let bytes: Vec<u8> = if let Some(text) = text {
            text.as_bytes().to_vec()
        } else if let Some(b64) = b64 {
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("decode {rel}: {e}"))?
        } else {
            continue;
        };
        if rel == ".plainstruct/site.json" {
            config_json = Some(String::from_utf8_lossy(&bytes).to_string());
            continue;
        }
        let path = crate::fsutil::safe_join(&final_dir, rel)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, &bytes).map_err(|e| format!("write {rel}: {e}"))?;
    }
    if let Some(json) = config_json {
        let dir = final_dir.join(".plainstruct");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join("site.json"), json).map_err(|e| e.to_string())?;
    }
    if let Some(github) = existing_github {
        let dir = final_dir.join(".plainstruct");
        std::fs::create_dir_all(&dir).ok();
        std::fs::write(dir.join("github.json"), github).ok();
    }
    Ok(final_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or(name))
}

/// 接收覆盖前的自动备份:数据目录 backups/lan-sync/lan-<时间戳>-<站点名>/,保留最近 5 份
pub fn backup_site(state: &AppState, name: &str) -> Result<PathBuf, String> {
    let src = sites_dir(state).join(crate::fsutil::safe_name(name));
    if !src.exists() {
        return Ok(src);
    }
    let backups = state.app_data().join("backups").join("lan-sync");
    std::fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let dest = backups.join(format!("lan-{secs:012}-{name}"));
    copy_dir_recursive(&src, &dest)?;
    // 只保留最近 BACKUP_KEEP 份
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(&backups)
        .map(|rd| rd.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    dirs.sort();
    while dirs.len() > BACKUP_KEEP {
        let oldest = dirs.remove(0);
        let _ = std::fs::remove_dir_all(oldest);
    }
    Ok(dest)
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let to = dest.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/* ---------- HTTP 服务 ---------- */

struct HttpRequest {
    method: String,
    path: String,
    query: HashMap<String, String>,
    body: Vec<u8>,
}

fn parse_query(raw: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in raw.split('&') {
        let (k, v) = match pair.split_once('=') {
            Some((k, v)) => (k, v),
            None => (pair, ""),
        };
        let k = percent_encoding::percent_decode_str(k).decode_utf8_lossy().to_string();
        let v = percent_encoding::percent_decode_str(v).decode_utf8_lossy().to_string();
        map.insert(k, v);
    }
    map
}

fn read_request(stream: &mut TcpStream) -> Option<HttpRequest> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));
    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    let mut chunk = [0u8; 8192];
    // 读到头结束(\r\n\r\n)
    let head_end = loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > 64 * 1024 {
            return None;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.lines();
    let request_line = lines.next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let mut content_length: usize = 0;
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                content_length = v.trim().parse().unwrap_or(0);
            }
        }
    }
    if content_length as u64 > BODY_LIMIT {
        return None;
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < content_length {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(content_length);
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), parse_query(q)),
        None => (target, HashMap::new()),
    };
    Some(HttpRequest { method, path, query, body })
}

fn http_response(status: u16, reason: &str, body: &str, extra: &[(&str, &str)]) -> Vec<u8> {
    let mut out = format!("HTTP/1.1 {status} {reason}\r\n");
    out.push_str("Content-Type: application/json; charset=utf-8\r\n");
    out.push_str("Access-Control-Allow-Origin: *\r\n");
    out.push_str("Access-Control-Allow-Private-Network: true\r\n");
    out.push_str(&format!("Content-Length: {}\r\n", body.len()));
    for (k, v) in extra {
        out.push_str(&format!("{k}: {v}\r\n"));
    }
    out.push_str("\r\n");
    let mut bytes = out.into_bytes();
    bytes.extend_from_slice(body.as_bytes());
    bytes
}

fn http_error(status: u16, reason: &str, code: &str) -> Vec<u8> {
    http_response(status, reason, &serde_json::json!({ "error": code }).to_string(), &[])
}

fn peer_url(peer: &LanPeer, path: &str, extra_query: &str) -> String {
    format!("http://{}:{}{}{path}?session={}{}", peer.ip, peer.port, HTTP_PREFIX, peer.session, extra_query)
}

fn handle_connection(svc: Arc<LanService>, mut stream: TcpStream) {
    let Some(req) = read_request(&mut stream) else { return };
    if req.method == "OPTIONS" {
        let out = http_response(
            204,
            "No Content",
            "",
            &[("Access-Control-Allow-Methods", "GET, PUT, OPTIONS"), ("Access-Control-Allow-Headers", "Content-Type")],
        );
        let _ = stream.write_all(&out);
        return;
    }
    if !req.path.starts_with(HTTP_PREFIX) {
        let _ = stream.write_all(&http_error(404, "Not Found", "not-found"));
        return;
    }
    if req.query.get("session").map(|s| s == &svc.session) != Some(true) {
        // 对方还持有旧 session(本机服务重启过):提示其刷新设备列表
        use tauri::Emitter;
        let _ = svc.app.emit(events::LAN_REJECTED, ());
        let _ = stream.write_all(&http_error(403, "Forbidden", "bad-session"));
        return;
    }
    let action = req.path[HTTP_PREFIX.len()..].to_string();
    match (req.method.as_str(), action.as_str()) {
        ("GET", "info") => {
            let state = svc.app.state::<AppState>();
            let body = serde_json::json!({
                "app": "plainstruct",
                "name": svc.device_name(),
                "platform": platform_name(),
                "trusted": svc.is_trusted(),
                "sites": local_sites(&state),
            });
            let _ = stream.write_all(&http_response(200, "OK", &body.to_string(), &[]));
        }
        ("GET", "site") => {
            if !svc.is_trusted() {
                let _ = stream.write_all(&http_error(403, "Forbidden", "untrusted"));
                return;
            }
            let name = req.query.get("name").cloned().unwrap_or_default();
            let state = svc.app.state::<AppState>();
            let root = sites_dir(&state).join(crate::fsutil::safe_name(&name));
            match bundle_site(&root) {
                Ok((bundle, _)) => {
                    let _ = stream.write_all(&http_response(200, "OK", &bundle.to_string(), &[]));
                }
                Err(_) => {
                    let _ = stream.write_all(&http_error(404, "Not Found", "no-site"));
                }
            }
        }
        ("PUT", "plan") => handle_plan(svc, &mut stream, &req),
        ("PUT", "data") => handle_data(svc, &mut stream, &req),
        _ => {
            let _ = stream.write_all(&http_error(404, "Not Found", "not-found"));
        }
    }
}

/// 推送第一阶段:信任网络自动接受,否则挂起等用户决定
fn handle_plan(svc: Arc<LanService>, stream: &mut TcpStream, req: &HttpRequest) {
    let Ok(plan) = serde_json::from_slice::<LanPushPlan>(&req.body) else {
        let _ = stream.write_all(&http_error(400, "Bad Request", "bad-plan"));
        return;
    };
    // 已有待处理计划时拒绝并发
    {
        let pending = svc.pending.lock().unwrap_or_else(|e| e.into_inner());
        if pending.is_some() {
            let _ = stream.write_all(&http_error(409, "Conflict", "busy"));
            return;
        }
    }
    if svc.is_trusted() {
        // 信任网络:自动接受,默认覆盖同名站点
        let token = random_token();
        *svc.decision.lock().unwrap_or_else(|e| e.into_inner()) = Some((token.clone(), "replace".into()));
        let _ = stream.write_all(&http_response(
            200,
            "OK",
            &serde_json::json!({ "status": "accepted", "token": token }).to_string(),
            &[],
        ));
        return;
    }
    // 交前端决定:mpsc 一对一应答(token 与落盘模式)
    let (tx, rx) = std::sync::mpsc::channel::<Option<(String, String)>>();
    *svc.pending.lock().unwrap_or_else(|e| e.into_inner()) = Some(PendingPlan { responder: tx });
    {
        use tauri::Emitter;
        let _ = svc.app.emit(events::LAN_INCOMING, &plan);
    }
    let decision = rx.recv_timeout(DECIDE_WAIT).ok().flatten();
    *svc.pending.lock().unwrap_or_else(|e| e.into_inner()) = None;
    match decision {
        Some((token, mode)) => {
            *svc.decision.lock().unwrap_or_else(|e| e.into_inner()) = Some((token.clone(), mode));
            let _ = stream.write_all(&http_response(
                200,
                "OK",
                &serde_json::json!({ "status": "accepted", "token": token }).to_string(),
                &[],
            ));
        }
        None => {
            let _ = stream.write_all(&http_error(408, "Request Timeout", "no-decision"));
        }
    }
}

/// 推送第二阶段:校验 token,按第一阶段决定的模式落盘(备份先行)
fn handle_data(svc: Arc<LanService>, stream: &mut TcpStream, req: &HttpRequest) {
    let Some((token, mode)) = svc.decision.lock().unwrap_or_else(|e| e.into_inner()).clone() else {
        let _ = stream.write_all(&http_error(409, "Conflict", "no-plan"));
        return;
    };
    if req.query.get("plan").map(|t| t == &token) != Some(true) {
        let _ = stream.write_all(&http_error(403, "Forbidden", "bad-token"));
        return;
    }
    if req.body.len() as u64 > BODY_LIMIT {
        let _ = stream.write_all(&http_error(413, "Payload Too Large", "too-large"));
        return;
    }
    let bundle: Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => {
            let _ = stream.write_all(&http_error(400, "Bad Request", "bad-bundle"));
            return;
        }
    };
    let state = svc.app.state::<AppState>();
    let result = apply_bundle(&state, &bundle, &mode);
    match result {
        Ok(site) => {
            // 通知前端接收完成(带落盘站点名,toast 用);进度以文件数计
            {
                use tauri::Emitter;
                let total = bundle
                    .get("files")
                    .and_then(|f| f.as_object())
                    .map(|f| f.len() as u64)
                    .unwrap_or(0);
                let _ = svc.app.emit(
                    events::LAN_PROGRESS,
                    serde_json::json!({ "direction": "receive", "received": total, "total": total, "site": site }),
                );
            }
            let _ = stream.write_all(
                &http_response(200, "OK", &serde_json::json!({ "status": "applied", "site": site }).to_string(), &[]),
            );
        }
        Err(e) => {
            let _ = stream.write_all(&http_response(500, "Server Error", &serde_json::json!({ "error": e }).to_string(), &[]));
        }
    }
}

/* ---------- 主动发送 / 拉取(客户端,阻塞调用,由命令线程执行) ---------- */

fn lan_client(total_timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(total_timeout)
        .build()
        .map_err(|e| e.to_string())
}

/// 发送计划并等待对方接受,返回 data 阶段 token
pub fn push_plan(svc: &LanService, peer: &LanPeer, site_name: &str, size_bytes: u64, file_count: u64) -> Result<String, String> {
    let client = lan_client(DECIDE_WAIT + Duration::from_secs(30))?;
    let body = serde_json::json!({
        "device": if svc.device_name().is_empty() { "未知设备".into() } else { svc.device_name() },
        "devicePlatform": platform_name(),
        "siteName": site_name,
        "sizeBytes": size_bytes,
        "fileCount": file_count,
    });
    let url = peer_url(peer, "plan", "");
    let resp = client.put(&url).json(&body).send().map_err(|e| format!("lan-connect: {e}"))?;
    let status = resp.status();
    let v: Value = resp.json().unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(v.get("error").and_then(|e| e.as_str()).unwrap_or("rejected").to_string());
    }
    Ok(v.get("token").and_then(|t| t.as_str()).ok_or("bad-response")?.to_string())
}

/// 传输站点包数据
pub fn push_data(peer: &LanPeer, token: &str, bundle: &Value) -> Result<(), String> {
    let client = lan_client(Duration::from_secs(600))?;
    let url = peer_url(peer, "data", &format!("&plan={token}"));
    let resp = client.put(&url).json(bundle).send().map_err(|e| format!("lan-transfer: {e}"))?;
    let status = resp.status();
    let v: Value = resp.json().unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(v.get("error").and_then(|e| e.as_str()).unwrap_or("transfer-failed").to_string());
    }
    Ok(())
}

/// 拉取对方站点包(要求对方信任当前网络)
pub fn pull_site_bundle(peer: &LanPeer, site_name: &str) -> Result<Value, String> {
    let client = lan_client(Duration::from_secs(600))?;
    let encoded = percent_encoding::utf8_percent_encode(site_name, percent_encoding::NON_ALPHANUMERIC);
    let url = peer_url(peer, "site", &format!("&name={encoded}"));
    let resp = client.get(&url).send().map_err(|e| format!("lan-connect: {e}"))?;
    let status = resp.status();
    let v: Value = resp.json().unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(v.get("error").and_then(|e| e.as_str()).unwrap_or("fetch-failed").to_string());
    }
    Ok(v)
}

/* ---------- 决定收到的计划(命令侧调用) ---------- */

fn service_of(state: &AppState) -> Result<Arc<LanService>, String> {
    state
        .lan
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "lan-not-running".to_string())
}

pub fn active_service(state: &AppState) -> Result<Arc<LanService>, String> {
    service_of(state)
}

/// 用户接受/拒绝计划;接受时返回 data 阶段 token(模式同时记录)
pub fn decide_incoming(state: &AppState, accept: bool, mode: &str) -> Result<Option<String>, String> {
    let svc = service_of(state)?;
    let pending = svc.pending.lock().unwrap_or_else(|e| e.into_inner()).take();
    let Some(pending) = pending else {
        return Ok(None);
    };
    if accept {
        let token = random_token();
        let _ = pending.responder.send(Some((token.clone(), mode.to_string())));
        Ok(Some(token))
    } else {
        let _ = pending.responder.send(None);
        Ok(None)
    }
}
