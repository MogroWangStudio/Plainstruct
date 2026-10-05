/** GitHub Pages 同步 -- REST + Git Data API,整站单次原子提交,无需本地 Git */
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::commands::app::now_millis;
use crate::commands::build::collect_build_files;
use crate::events::{PUBLISH_LOG, SYNC_PROGRESS};
use crate::state::{ensure_main, AppState};

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GithubConfig {
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub repo: String,
    #[serde(default = "default_branch")]
    pub branch: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub auto_create: bool,
    /// 账户类型:"user" = 个人账号,"org" = 组织。决定自动创建仓库走哪个接口
    /// (/user/repos 或 /orgs/{org}/repos)——填组织名却走个人接口会被 GitHub
    /// 以 403 / 404 拒绝,这正是旧配置最容易踩的坑。旧配置无此字段时按个人处理。
    #[serde(default = "default_account_type")]
    pub account_type: String,
}

fn default_branch() -> String {
    "gh-pages".into()
}

fn default_account_type() -> String {
    "user".into()
}

impl GithubConfig {
    /// 是否组织账户(空值/未知值一律按个人处理,兼容旧配置)
    fn is_org(&self) -> bool {
        self.account_type.eq_ignore_ascii_case("org")
            || self.account_type.eq_ignore_ascii_case("organization")
    }

    /// 自动创建仓库的接口:组织仓库必须创建在组织下
    fn create_repo_url(&self) -> String {
        if self.is_org() {
            format!("{API}/orgs/{}/repos", self.owner)
        } else {
            format!("{API}/user/repos")
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_exists: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pages_enabled: Option<bool>,
    /// 填写的 owner 在 GitHub 上是组织(false = 个人账号);账户类型选错时前端据此提示
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_is_org: Option<bool>,
    /// 个人账户:填写的用户名是否就是令牌所属账号(个人账户只能在自己的账号下自动建仓)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_matches_user: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl VerifyResult {
    /// 只带失败原因的结果(其余诊断字段留空)
    fn failed(message: &str) -> Self {
        VerifyResult {
            ok: false,
            user: None,
            repo_exists: None,
            pages_enabled: None,
            owner_is_org: None,
            owner_matches_user: None,
            message: Some(message.into()),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub done: u32,
    pub total: u32,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub commit_sha: String,
    pub pages_url: String,
}

/// Pages 部署状态(针对本次发布提交)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagesStatus {
    /// 本次发布的提交已在 Pages 上构建完成,可以打开站点
    pub ready: bool,
    /// 部署失败(构建出错)
    pub errored: bool,
    /// GitHub 返回的原始构建状态(built / building / errored / none / http-xxx)
    pub status: String,
}

/// 发布前预检结果:提醒而非阻断,前端据此向用户确认
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightResult {
    /// content 目录在最近一次构建后有修改(本地构建已过期,建议重新构建)
    pub build_stale: bool,
    /// 云端发布分支的最新提交与本站点上次发布的记录不一致(云端可能被其他设备更新,发布将覆盖)
    pub remote_dirty: bool,
}

const API: &str = "https://api.github.com";

/// 计算文件的 git blob sha(与 GitHub 对象库一致):sha1("blob <len>\0" + content)。
/// 用于增量上传:本地 sha 与云端 tree 中相同,即内容未变化,无需重复上传。
fn git_blob_sha(bytes: &[u8]) -> String {
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(format!("blob {}\0", bytes.len()));
    hasher.update(bytes);
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// 递归取目录内文件的最大修改时间(目录不存在或无文件返回 None)
fn newest_mtime(dir: &std::path::Path) -> Option<std::time::SystemTime> {
    let mut newest: Option<std::time::SystemTime> = None;
    for entry in walkdir::WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        if let Some(t) = entry.metadata().ok().and_then(|md| md.modified().ok()) {
            if newest.map_or(true, |n| t > n) {
                newest = Some(t);
            }
        }
    }
    newest
}

/// 统一请求:返回 (状态码, 响应 JSON)。token 为空时不带 Authorization(公开接口)
async fn request(
    http: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    token: &str,
    body: Option<Value>,
) -> Result<(u16, Value), String> {
    let mut req = http
        .request(method, url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().await.map_err(|e| format!("网络错误: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    let value = serde_json::from_str::<Value>(&text).unwrap_or(Value::Null);
    Ok((status, value))
}

fn repo_api(cfg: &GithubConfig, suffix: &str) -> String {
    format!("{API}/repos/{}/{}{suffix}", cfg.owner, cfg.repo)
}

#[tauri::command]
pub async fn github_read_config(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<GithubConfig, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let path = root.join(".plainstruct").join("github.json");
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("github.json 解析失败: {e}")),
        Err(_) => Ok(GithubConfig {
            owner: String::new(),
            repo: String::new(),
            branch: default_branch(),
            token: String::new(),
            auto_create: true,
            account_type: default_account_type(),
        }),
    }
}

#[tauri::command]
pub fn github_save_config(window: tauri::WebviewWindow, state: State<'_, AppState>, cfg: GithubConfig) -> Result<(), String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let dir = root.join(".plainstruct");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("github.json"), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn github_verify(window: tauri::WebviewWindow, state: State<'_, AppState>, cfg: GithubConfig) -> Result<VerifyResult, String> {
    ensure_main(&window)?;
    let http = state.http.clone();
    if cfg.token.is_empty() {
        return Ok(VerifyResult::failed("invalid-token"));
    }

    if cfg.owner.trim().is_empty() {
        return Ok(VerifyResult::failed("owner-empty"));
    }

    let (status, user) = request(&http, reqwest::Method::GET, &format!("{API}/user"), &cfg.token, None).await?;
    if status == 401 || status == 403 {
        return Ok(VerifyResult::failed("invalid-token"));
    }
    if status != 200 {
        return Err(format!("GitHub 返回 {status}"));
    }
    let login = user["login"].as_str().unwrap_or("").to_string();

    // owner 在 GitHub 上是个人还是组织(公开接口,不需要额外权限):
    // 账户类型选错时(如把组织名填进「个人用户」),发布必然失败,这里提前给出提示
    let (owner_status, owner_body) = request(
        &http,
        reqwest::Method::GET,
        &format!("{API}/users/{}", cfg.owner),
        &cfg.token,
        None,
    )
    .await?;
    let owner_is_org = (owner_status == 200)
        .then(|| owner_body["type"].as_str().map(|t| t.eq_ignore_ascii_case("organization")))
        .flatten();
    // 仅个人账户适用:填写的用户名是否就是令牌所属账号
    let owner_matches_user = (!cfg.is_org()).then(|| login.eq_ignore_ascii_case(cfg.owner.trim()));

    // 组织仓库:先确认令牌能访问该组织(403 = 未授权该组织,404 = 组织不存在或令牌不可见)。
    // 这一步把旧版只能靠发布失败发现的 403 提前到「验证连接」阶段
    if cfg.is_org() {
        let (org_status, _) = request(
            &http,
            reqwest::Method::GET,
            &format!("{API}/orgs/{}", cfg.owner),
            &cfg.token,
            None,
        )
        .await?;
        if org_status != 200 {
            return Ok(VerifyResult {
                ok: false,
                user: Some(login),
                repo_exists: None,
                pages_enabled: None,
                owner_is_org,
                owner_matches_user,
                message: Some(if org_status == 403 { "org-forbidden".into() } else { "org-not-found".into() }),
            });
        }
    }

    let (repo_status, _) = request(
        &http,
        reqwest::Method::GET,
        &repo_api(&cfg, ""),
        &cfg.token,
        None,
    )
    .await?;
    // 403 = 令牌无权访问该仓库(组织仓库常见),与「仓库不存在」必须区分开
    if repo_status == 403 {
        return Ok(VerifyResult {
            ok: false,
            user: Some(login),
            repo_exists: Some(false),
            pages_enabled: None,
            owner_is_org,
            owner_matches_user,
            message: Some("repo-forbidden".into()),
        });
    }
    let repo_exists = repo_status == 200;

    let (pages_status, _) = request(
        &http,
        reqwest::Method::GET,
        &repo_api(&cfg, "/pages"),
        &cfg.token,
        None,
    )
    .await?;
    let pages_enabled = pages_status == 200;

    Ok(VerifyResult {
        ok: true,
        user: Some(login),
        repo_exists: Some(repo_exists),
        pages_enabled: Some(pages_enabled),
        owner_is_org,
        owner_matches_user,
        message: None,
    })
}

fn pages_url(cfg: &GithubConfig) -> String {
    if cfg
        .repo
        .eq_ignore_ascii_case(&format!("{}.github.io", cfg.owner))
    {
        format!("https://{}/", cfg.repo)
    } else {
        format!("https://{}.github.io/{}/", cfg.owner, cfg.repo)
    }
}

/// 发布前预检:检测本地构建是否过期、云端是否被本站点之外更新。
/// 仅作提醒(网络异常时不阻断发布),前端据此向用户确认。
#[tauri::command]
pub async fn github_preflight(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    cfg: GithubConfig,
) -> Result<PreflightResult, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;

    // 本地构建过期:content 在 build 之后有过修改(改了文档还没重新构建)
    let content_newest = newest_mtime(&root.join("content"));
    let build_newest = newest_mtime(&root.join("build"));
    let build_stale = match (content_newest, build_newest) {
        (Some(c), Some(b)) => c > b,
        // 从未构建过(build 不存在):视为需要构建
        (Some(_), None) => true,
        _ => false,
    };

    // 云端外部更新:分支存在且其最新提交与本站点上次发布的记录不一致
    let mut remote_dirty = false;
    if !cfg.owner.is_empty() && !cfg.repo.is_empty() && !cfg.branch.trim().is_empty() {
        let http = state.http.clone();
        let ref_url = repo_api(&cfg, &format!("/git/ref/heads/{}", cfg.branch.replace('/', "%2F")));
        let (ref_status, ref_body) = request(&http, reqwest::Method::GET, &ref_url, &cfg.token, None).await?;
        if ref_status == 200 {
            let cloud_commit = ref_body["object"]["sha"].as_str().unwrap_or("").to_string();
            let record = root
                .join(".plainstruct")
                .join("last-publish.json");
            let recorded = std::fs::read_to_string(record)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .and_then(|v| v["commit"].as_str().map(|s| s.to_string()));
            if let Some(recorded) = recorded {
                remote_dirty = recorded != cloud_commit;
            }
        }
    }

    Ok(PreflightResult { build_stale, remote_dirty })
}

/// 查询 Pages 最新一次构建是否已覆盖本次发布的提交。
/// GitHub Pages 在推送后需要一到数分钟完成部署,前端据此决定是否打开站点。
#[tauri::command]
pub async fn github_pages_status(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    cfg: GithubConfig,
    commit: String,
) -> Result<PagesStatus, String> {
    ensure_main(&window)?;
    let http = state.http.clone();
    let (status, body) = request(
        &http,
        reqwest::Method::GET,
        &repo_api(&cfg, "/pages/builds/latest"),
        &cfg.token,
        None,
    )
    .await?;
    if status != 200 {
        // 404 = Pages 尚未产生过构建;其余按原始状态码透出
        let kind = if status == 404 { "none".to_string() } else { format!("http-{status}") };
        return Ok(PagesStatus { ready: false, errored: false, status: kind });
    }
    let build_status = body["status"].as_str().unwrap_or("").to_string();
    let built_commit = body["commit"].as_str().unwrap_or("").to_string();
    // 比较短 sha(7 位),对 API 返回完整/短格式均兼容
    let short = |s: &str| s.chars().take(7).collect::<String>();
    let ready = build_status == "built"
        && !built_commit.is_empty()
        && short(&built_commit) == short(&commit);
    Ok(PagesStatus {
        ready,
        errored: build_status == "errored",
        status: if build_status.is_empty() { "none".into() } else { build_status },
    })
}

/// 发布日志:实时反馈流程与状态,错误也经此落日志便于用户定位
fn emit_log(app: &AppHandle, level: &str, message: impl Into<String>) {
    let _ = app.emit(
        PUBLISH_LOG,
        json!({ "level": level, "message": message.into(), "time": now_millis() }),
    );
}

#[tauri::command]
pub async fn github_sync(
    window: tauri::WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    cfg: GithubConfig,
) -> Result<SyncResult, String> {
    ensure_main(&window)?;
    let result = github_sync_inner(&app, &state, cfg).await;
    match &result {
        Ok(r) => {
            let sha = r.commit_sha.get(..7).unwrap_or(&r.commit_sha).to_string();
            emit_log(&app, "success", format!("发布完成:提交 {sha} 已推送,站点地址 {}", r.pages_url));
        }
        Err(e) => emit_log(&app, "error", format!("发布失败:{e}")),
    }
    result
}

async fn github_sync_inner(app: &AppHandle, state: &AppState, cfg: GithubConfig) -> Result<SyncResult, String> {
    if cfg.token.is_empty() || cfg.owner.is_empty() || cfg.repo.is_empty() {
        return Err("请先填写用户名(或组织名)、仓库名与访问令牌".into());
    }
    let root = state.site_root()?;
    let files = collect_build_files(&root)?;
    if files.is_empty() {
        return Err("构建目录为空,请先构建站点".into());
    }
    let http = state.http.clone();
    let total = files.len() as u32;
    emit_log(app, "info", format!("准备发布:共 {total} 个文件"));

    // 1. 校验令牌
    emit_log(app, "info", "校验访问令牌…");
    let (status, _) = request(&http, reqwest::Method::GET, &format!("{API}/user"), &cfg.token, None).await?;
    if status == 401 || status == 403 {
        return Err("invalid-token".into());
    }

    // 2. 确保仓库存在
    emit_log(app, "info", format!("检查仓库 {}/{}…", cfg.owner, cfg.repo));
    let (repo_status, _) = request(&http, reqwest::Method::GET, &repo_api(&cfg, ""), &cfg.token, None).await?;
    if repo_status == 403 {
        // 组织仓库的典型失败:令牌未被授权该组织(组织也可能限制了第三方访问)
        return Err(if cfg.is_org() {
            format!(
                "令牌无权访问组织 {}(403)。请确认访问令牌已授权该组织:经典令牌需勾选该组织的 repo 权限,细粒度令牌需选择该组织并授予仓库读写权限。",
                cfg.owner
            )
        } else {
            format!("令牌无权访问仓库 {}/{}(403),请检查令牌权限。", cfg.owner, cfg.repo)
        });
    }
    if repo_status == 404 {
        if !cfg.auto_create {
            return Err(format!("仓库 {}/{} 不存在", cfg.owner, cfg.repo));
        }
        // 建仓接口随账户类型分流:组织仓库必须建在组织下。旧版一律用 /user/repos,
        // 填组织名时会被 GitHub 拒绝(403 无权创建 / 仓库落到个人账号名下)
        let org = cfg.is_org();
        emit_log(
            app,
            "info",
            if org {
                format!("仓库不存在,正在组织 {} 下自动创建…", cfg.owner)
            } else {
                "仓库不存在,正在自动创建…".to_string()
            },
        );
        let (create_status, create_body) = request(
            &http,
            reqwest::Method::POST,
            &cfg.create_repo_url(),
            &cfg.token,
            // auto_init:完全空仓库无法通过 Git API 创建首个分支引用(会 409),
            // 让 GitHub 自带初始提交把仓库初始化
            Some(json!({ "name": cfg.repo, "private": false, "auto_init": true })),
        )
        .await?;
        if create_status != 201 && create_status != 202 {
            let msg = create_body["message"].as_str().unwrap_or("");
            return Err(match (create_status, org) {
                (403, true) => format!(
                    "在组织 {} 下创建仓库失败(403): {msg}。请确认令牌已授权该组织,且组织允许成员创建仓库。",
                    cfg.owner
                ),
                (403, false) => format!("创建仓库失败(403): {msg}。令牌需要 repo 权限。"),
                _ => format!("创建仓库失败({create_status}): {msg}"),
            });
        }
        emit_log(app, "info", if org { "组织仓库已创建" } else { "仓库已创建" });
    } else if repo_status != 200 {
        return Err(format!("访问仓库失败({repo_status})"));
    }

    let branch_ref = format!("refs/heads/{}", cfg.branch);
    // 引用 API 的路径形式(经 GitHub 文档确认,三个端点并不一致):
    //   读取:GET  /git/ref/{ref}(单数 ref),ref 用 heads/{分支}
    //   更新:PATCH /git/refs/{ref}(复数 refs!打到单数路径会 404)
    //   创建:POST /git/refs,body 里的 ref 用完整 refs/heads/{分支}
    let ref_url = repo_api(&cfg, &format!("/git/ref/heads/{}", cfg.branch.replace('/', "%2F")));
    let ref_update_url = repo_api(&cfg, &format!("/git/refs/heads/{}", cfg.branch.replace('/', "%2F")));

    // 3. 取基准提交。分支不存在时不预建空树(Git API 拒绝空 tree 数组,会 422),
    //    直接以本次站点提交(无 parents)作为发布分支的初始提交,提交后再创建 ref。
    //    完全空仓库(无任何提交)的 ref 查询返回 409「Git Repository is empty」,
    //    且 Git API 无法在空仓库直接创建 ref:先用 Contents API 在发布分支放入
    //    种子文件生成初始提交,再以该提交为基准发布(站点提交随后全量替换种子文件)
    emit_log(app, "info", format!("查询发布分支 {}…", cfg.branch));
    let (ref_status, ref_body) = request(&http, reqwest::Method::GET, &ref_url, &cfg.token, None).await?;
    let mut base_commit: Option<String> = None;
    let mut branch_exists = false;
    if ref_status == 200 {
        base_commit = ref_body["object"]["sha"].as_str().map(|s| s.to_string());
        branch_exists = true;
        emit_log(app, "info", "发布分支已存在,将基于云端最新提交增量更新");
    } else if ref_status == 409 {
        // 完全空仓库:Git API 无法直接创建引用(409),而 Contents API 的首个写入
        // 只接受仓库默认分支(指定其他分支会 404 Not Found)。因此:
        // 先把种子提交写到默认分支,仓库不再为空后,再用 Git API 从该提交创建发布分支
        emit_log(app, "info", "仓库为空,正在初始化…");
        let (info_status, repo_info) = request(&http, reqwest::Method::GET, &repo_api(&cfg, ""), &cfg.token, None).await?;
        if info_status != 200 {
            return Err(format!("访问仓库失败({info_status})"));
        }
        let default_branch = repo_info["default_branch"].as_str().unwrap_or("main").to_string();
        emit_log(app, "info", format!("向默认分支 {default_branch} 写入初始化提交…"));
        let (seed_status, seed_body) = request(
            &http,
            reqwest::Method::PUT,
            &repo_api(&cfg, "/contents/plainstruct-init.md"),
            &cfg.token,
            Some(json!({
                "message": "plainstruct: init repository",
                "content": B64.encode(b"# Plainstruct\n\nThis branch is published by Plainstruct. Site content replaces this file on first publish.\n"),
                "branch": default_branch,
            })),
        )
        .await?;
        if seed_status != 201 && seed_status != 200 {
            let msg = seed_body["message"].as_str().unwrap_or("");
            return Err(format!("初始化仓库失败({seed_status}): {msg}"));
        }
        let seed_commit = seed_body["commit"]["sha"]
            .as_str()
            .ok_or("初始化响应缺少提交 SHA")?
            .to_string();
        // 仓库已有提交:从种子提交创建发布分支(非空仓库 Git API 正常)
        emit_log(app, "info", format!("创建发布分支 {}…", cfg.branch));
        let (created, create_body) = request(
            &http,
            reqwest::Method::POST,
            &repo_api(&cfg, "/git/refs"),
            &cfg.token,
            Some(json!({ "ref": branch_ref, "sha": seed_commit })),
        )
        .await?;
        if created != 201 {
            let msg = create_body["message"].as_str().unwrap_or("").to_string();
            let already_exists = created == 422 && msg.to_lowercase().contains("exist");
            if !already_exists {
                return Err(format!("创建发布分支失败({created}): {msg}"));
            }
        }
        // 重新取发布分支基准;此后走常规的分支更新路径
        let (ref_status, ref_body) = request(&http, reqwest::Method::GET, &ref_url, &cfg.token, None).await?;
        if ref_status == 200 {
            base_commit = ref_body["object"]["sha"].as_str().map(|s| s.to_string());
            branch_exists = true;
            emit_log(app, "info", "发布分支已就绪,开始写入站点内容");
        }
    } else {
        emit_log(app, "info", format!("发布分支不存在(ref 查询返回 {ref_status}),将创建分支并写入首个站点提交"));
    }

    // 4. 逐文件建 blob(全量替换,天然处理删除)。增量:先取云端现有 tree 的
    //    path -> blob sha 映射,内容未变化的文件直接复用云端 blob,不再重复上传
    let mut remote_shas: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if let Some(base) = &base_commit {
        emit_log(app, "info", "对比云端内容,计算需要上传的变更…");
        let (t_status, t_body) = request(
            &http,
            reqwest::Method::GET,
            &repo_api(&cfg, &format!("/git/trees/{base}?recursive=1")),
            &cfg.token,
            None,
        )
        .await?;
        if t_status == 200 {
            if let Some(items) = t_body["tree"].as_array() {
                for it in items {
                    if it["type"] == "blob" {
                        if let (Some(p), Some(s)) = (it["path"].as_str(), it["sha"].as_str()) {
                            remote_shas.insert(p.to_string(), s.to_string());
                        }
                    }
                }
            }
        }
    }

    let mut tree_items = Vec::with_capacity(files.len());
    let mut reused: usize = 0;
    for (i, (path, bytes)) in files.iter().enumerate() {
        let local_sha = git_blob_sha(bytes);
        let sha = if remote_shas.get(path).map(|s| s.as_str()) == Some(local_sha.as_str()) {
            reused += 1;
            local_sha
        } else {
            let (blob_status, blob) = request(
                &http,
                reqwest::Method::POST,
                &repo_api(&cfg, "/git/blobs"),
                &cfg.token,
                Some(json!({ "content": B64.encode(bytes), "encoding": "base64" })),
            )
            .await?;
            if blob_status != 201 {
                let msg = blob["message"].as_str().unwrap_or("");
                return Err(format!("上传 {path} 失败({blob_status}): {msg}"));
            }
            blob["sha"].as_str().ok_or("blob 响应缺少 sha")?.to_string()
        };
        tree_items.push(json!({ "path": path, "mode": "100644", "type": "blob", "sha": sha }));

        let _ = app.emit(
            SYNC_PROGRESS,
            SyncProgress {
                done: i as u32 + 1,
                total,
                message: path.clone(),
            },
        );
    }

    // 4.5 Pages 基础设施文件保留:CNAME / .nojekyll 不属于构建产物,而发布 tree 是
    //    不带 base_tree 的精确替换 —— 产物之外的一切都会从发布分支上移除。
    //    deploy-from-branch 模式下分支根目录的 CNAME 就是自定义域名的事实来源,
    //    被清后下一次 Pages 构建会把域名设置一并清空。三层兜底:
    //    产物自带 CNAME 以产物为准;否则复用云端分支的 CNAME blob(增量对比已取过
    //    全量 tree,零额外请求);连分支都没有时按 Pages 设置的 cname 恢复。
    //    .nojekyll 仅在云端已有时原样保留(素构产物无下划线路径,不主动新建)。
    if !files.iter().any(|(p, _)| p == "CNAME") {
        if let Some(sha) = remote_shas.get("CNAME") {
            tree_items.push(json!({ "path": "CNAME", "mode": "100644", "type": "blob", "sha": sha }));
            emit_log(app, "info", "已保留云端的自定义域名(CNAME)");
        } else if let Ok((pages_status, pages_body)) =
            request(&http, reqwest::Method::GET, &repo_api(&cfg, "/pages"), &cfg.token, None).await
        {
            let cname = pages_body["cname"].as_str().map(str::trim).unwrap_or("");
            if pages_status == 200 && !cname.is_empty() {
                if let Ok((blob_status, blob)) = request(
                    &http,
                    reqwest::Method::POST,
                    &repo_api(&cfg, "/git/blobs"),
                    &cfg.token,
                    Some(json!({ "content": B64.encode(format!("{cname}\n")), "encoding": "base64" })),
                )
                .await
                {
                    if blob_status == 201 {
                        if let Some(sha) = blob["sha"].as_str() {
                            tree_items.push(json!({ "path": "CNAME", "mode": "100644", "type": "blob", "sha": sha }));
                            emit_log(app, "info", format!("已按 Pages 设置恢复自定义域名:{cname}"));
                        }
                    }
                }
            }
        }
    }
    if !files.iter().any(|(p, _)| p == ".nojekyll") {
        if let Some(sha) = remote_shas.get(".nojekyll") {
            tree_items.push(json!({ "path": ".nojekyll", "mode": "100644", "type": "blob", "sha": sha }));
            emit_log(app, "info", "已保留云端的 .nojekyll");
        }
    }

    // 5. tree(不带 base_tree = 精确替换,自动清理已删除文件)-> commit -> 更新 ref
    let changed = files.len() - reused;
    emit_log(
        app,
        "info",
        if reused > 0 {
            format!("上传完成:{changed} 个文件有变更,复用 {reused} 个未变化文件;构建产物中已删除的文件将从站点移除")
        } else {
            format!("上传完成:{changed} 个文件")
        },
    );
    emit_log(app, "info", "创建目录树与提交…");
    let tree_body = json!({ "tree": tree_items });
    let (tree_status, new_tree) = request(
        &http,
        reqwest::Method::POST,
        &repo_api(&cfg, "/git/trees"),
        &cfg.token,
        Some(tree_body),
    )
    .await?;
    if tree_status != 201 {
        let msg = new_tree["message"].as_str().unwrap_or("");
        return Err(format!("创建 tree 失败({tree_status}): {msg}"));
    }
    let tree_sha = new_tree["sha"].as_str().ok_or("创建 tree 失败")?.to_string();

    let mut commit_body = json!({
        "message": "plainstruct: publish site",
        "tree": tree_sha,
    });
    if let Some(base) = &base_commit {
        commit_body["parents"] = json!([base]);
    }
    let (commit_status, commit) = request(
        &http,
        reqwest::Method::POST,
        &repo_api(&cfg, "/git/commits"),
        &cfg.token,
        Some(commit_body),
    )
    .await?;
    if commit_status != 201 {
        let msg = commit["message"].as_str().unwrap_or("");
        return Err(format!("创建提交失败({commit_status}): {msg}"));
    }
    let commit_sha = commit["sha"].as_str().ok_or("提交缺少 sha")?.to_string();
    let short_sha = commit_sha.get(..7).unwrap_or(&commit_sha).to_string();
    emit_log(app, "info", format!("提交 {short_sha} 已创建,正在更新发布分支…"));

    // 6. 更新发布分支引用(幂等收敛,杜绝引用状态冲突):
    //    每次发布都基于云端最新提交(parent = base)生成单线历史;更新失败
    //    (分支被删)自动转为创建,创建失败(already exists,探测有偏差或
    //    并发所致)自动转为重查后强推更新 —— 无论上游状态如何漂移都能收敛
    let patch_body = json!({ "sha": commit_sha, "force": true });
    let mut ref_updated = false;
    if branch_exists {
        let (ref_status, _ref_body) = request(
            &http,
            reqwest::Method::PATCH,
            &ref_update_url,
            &cfg.token,
            Some(patch_body.clone()),
        )
        .await?;
        if ref_status == 200 {
            ref_updated = true;
            emit_log(app, "info", "发布分支已更新");
        }
    }
    if !ref_updated {
        let (created, ref_body) = request(
            &http,
            reqwest::Method::POST,
            &repo_api(&cfg, "/git/refs"),
            &cfg.token,
            Some(json!({ "ref": branch_ref, "sha": commit_sha })),
        )
        .await?;
        if created != 201 {
            let msg = ref_body["message"].as_str().unwrap_or("").to_string();
            let already_exists = created == 422 && msg.to_lowercase().contains("exist");
            if !already_exists {
                return Err(format!("创建发布分支失败({created}): {msg}"));
            }
            // 分支实际已存在:直接强推更新(不再依赖重查,避免查询侧偏差再次误判)
            let (patch_status, patch_body) = request(
                &http,
                reqwest::Method::PATCH,
                &ref_update_url,
                &cfg.token,
                Some(patch_body.clone()),
            )
            .await?;
            if patch_status != 200 {
                let msg = patch_body["message"].as_str().unwrap_or("");
                return Err(format!("更新分支失败({patch_status}): {msg}"));
            }
            emit_log(app, "info", "发布分支已更新(经创建兜底收敛)");
        }
    }

    // 7. 尽力开启 Pages(失败不影响发布结果,但失败原因写入日志便于定位:
    //    组织可能禁用了 Pages,或令牌缺少 Pages 权限)
    let (pages_status, _) = request(&http, reqwest::Method::GET, &repo_api(&cfg, "/pages"), &cfg.token, None).await?;
    if pages_status == 404 {
        emit_log(app, "info", "首次发布:正在开启 GitHub Pages…");
        let (enable_status, enable_body) = request(
            &http,
            reqwest::Method::POST,
            &repo_api(&cfg, "/pages"),
            &cfg.token,
            Some(json!({ "source": { "branch": cfg.branch, "path": "/" } })),
        )
        .await?;
        if enable_status == 201 || enable_status == 202 {
            emit_log(app, "info", "GitHub Pages 已开启(指向发布分支)");
        } else if enable_status == 403 {
            emit_log(
                app,
                "error",
                if cfg.is_org() {
                    format!(
                        "开启 GitHub Pages 被拒绝(403):组织 {} 可能禁用了 Pages。请在组织设置中允许 Pages,或手动开启(内容已发布)。",
                        cfg.owner
                    )
                } else {
                    "开启 GitHub Pages 被拒绝(403):访问令牌缺少 Pages 权限(内容已发布)".to_string()
                },
            );
        } else {
            let msg = enable_body["message"].as_str().unwrap_or("");
            emit_log(app, "error", format!("开启 GitHub Pages 失败({enable_status}): {msg}(内容已发布)"));
        }
    } else if pages_status == 200 {
        emit_log(app, "info", "GitHub Pages 已开启,跳过");
    } else {
        emit_log(app, "info", format!("未能读取 Pages 配置(返回 {pages_status}),跳过自动开启"));
    }

    // 8. 记录本次发布的提交,供下次发布前检测云端是否被其他设备更新
    let record = json!({ "commit": commit_sha, "publishedAt": now_millis() });
    let record_dir = root.join(".plainstruct");
    if std::fs::create_dir_all(&record_dir).is_ok() {
        let _ = std::fs::write(
            record_dir.join("last-publish.json"),
            serde_json::to_string_pretty(&record).unwrap_or_default(),
        );
    }

    Ok(SyncResult {
        commit_sha,
        pages_url: pages_url(&cfg),
    })
}

/* ---------------- 自动更新 ---------------- */

const UPDATE_TASK_FILE: &str = "update-task.json";
const UPDATE_HELPER_FILE: &str = "update-helper";
/// 向导运行日志(Windows):文件名与 WIN_WIZARD_SCRIPT 内写入处保持一致
const UPDATE_LOG_FILE: &str = "update-wizard-log.txt";

/// 更新任务目录。Windows 便携版直接使用 exe 所在根目录(更新包与向导脚本随程序
/// 摆放,用户在程序目录可直接看到安装包);目录不可写时回退系统临时目录的专属
/// 子目录。macOS 使用系统临时目录的专属子目录。
pub(crate) fn update_dir() -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Some(dir) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        {
            // 可写探测:实际写入并删除一个探测文件
            let probe = dir.join(".plainstruct-update-probe");
            if std::fs::write(&probe, b"ok").is_ok() {
                let _ = std::fs::remove_file(&probe);
                return dir;
            }
        }
    }
    std::env::temp_dir().join("plainstruct-update")
}

/// 已下载待安装的更新任务(任务目录内的持久化标记,重启后仍可「重启并更新」)
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateTask {
    pub version: String,
    pub asset_name: String,
}

pub(crate) fn read_update_task() -> Option<UpdateTask> {
    let file = update_dir().join(UPDATE_TASK_FILE);
    std::fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn write_update_task(task: &UpdateTask) -> Result<(), String> {
    let dir = update_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(task).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(UPDATE_TASK_FILE), json).map_err(|e| e.to_string())
}

/// 应用启动时清理更新残留:任务不存在或版本不新于当前(已装上/已过期)时清理;
/// 有有效的待安装任务则保留,bootstrap 会暴露给前端显示「重启并更新」。
/// 注意:任务目录可能是 exe 根目录,绝不能整目录删除;exe 根目录里只清理任务
/// 文件、向导脚本与任务指名的更新包,其余 zip 可能是用户手动存放的发行包或
/// 可续传的半成品,一律不动。
pub(crate) fn cleanup_update_task(current_version: &str) {
    let dir = update_dir();
    let task = read_update_task();
    let keep = task
        .as_ref()
        .filter(|t| {
            crate::commands::app::is_newer(&t.version, current_version)
                && dir.join(&t.asset_name).exists()
        })
        .is_some();
    if keep {
        return;
    }
    if dir.file_name().map_or(false, |n| n == "plainstruct-update") {
        // 专属子目录:整目录删除
        let _ = std::fs::remove_dir_all(&dir);
        return;
    }
    remove_task_files(&dir, task.as_ref());
}

/// 清理任务文件、向导脚本、失败日志与任务指名的更新包(exe 根目录场景)
fn remove_task_files(dir: &std::path::Path, task: Option<&UpdateTask>) {
    let _ = std::fs::remove_file(dir.join(UPDATE_TASK_FILE));
    for script in [".ps1", ".command"] {
        let _ = std::fs::remove_file(dir.join(format!("{UPDATE_HELPER_FILE}{script}")));
    }
    let _ = std::fs::remove_file(dir.join(UPDATE_LOG_FILE));
    if let Some(t) = task {
        let _ = std::fs::remove_file(dir.join(&t.asset_name));
    }
}

/// 选择当前平台的更新包:按关键字符匹配(大小写不敏感),不依赖文件名里的版本号
/// 与分隔符写法——Windows 一律为免安装 zip(解压覆盖更新),macOS 用 dmg;
/// x64 字样用于区分架构,官方产物名均携带。
fn asset_matches(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    #[cfg(target_os = "windows")]
    {
        n.ends_with(".zip") && n.contains("portable") && n.contains("x64")
    }
    #[cfg(target_os = "macos")]
    {
        n.ends_with(".dmg")
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = n;
        false
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadResult {
    pub version: String,
    pub asset_name: String,
    /// true = 因用户暂停而中途返回(断点已保留,再次调用自动续传)
    pub paused: bool,
}

/// 下载官方最新 Release 的当前平台更新包。支持暂停(保留断点,再次调用自动续传)
/// 与取消(清理残留);完成后生成更新向导脚本与任务文件,由「重启并更新」拉起向导。
#[tauri::command]
pub async fn update_download(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<UpdateDownloadResult, String> {
    use crate::events::UPDATE_PROGRESS;
    use std::io::Write;
    use std::sync::atomic::Ordering;

    ensure_main(&window)?;
    let http = state.http.clone();
    let current = env!("CARGO_PKG_VERSION").to_string();
    state.update_pause.store(false, Ordering::SeqCst);
    state.update_cancel.store(false, Ordering::SeqCst);

    // 1. 最新 Release 与版本比较
    let (status, body) = request(&http, reqwest::Method::GET, crate::commands::app::RELEASES_API, "", None).await?;
    if status != 200 {
        return Err(format!("GitHub 返回 {status}"));
    }
    let tag = body["tag_name"].as_str().unwrap_or("").trim().to_string();
    if tag.is_empty() {
        return Err("Release 数据缺少版本号。".into());
    }
    let latest = tag.trim_start_matches(['v', 'V']).to_string();
    if !crate::commands::app::is_newer(&latest, &current) {
        return Err("already-latest".into());
    }

    // 2. 选择当前平台的更新包
    let asset = body["assets"]
        .as_array()
        .and_then(|list| list.iter().find(|a| asset_matches(a["name"].as_str().unwrap_or(""))))
        .ok_or("Release 中没有当前平台的安装包")?;
    let asset_name = asset["name"].as_str().unwrap_or("").to_string();
    let asset_url = asset["browser_download_url"].as_str().unwrap_or("").to_string();
    if asset_url.is_empty() {
        return Err("安装包下载地址缺失".into());
    }
    // 记录进行中的包名:取消时(含暂停后取消,此时任务文件尚未落盘)据此删除半成品
    if let Ok(mut guard) = state.update_asset.lock() {
        *guard = Some(asset_name.clone());
    }

    // 3. 流式下载,进度经事件广播:存在未完成的同名包时尝试断点续传,
    //    服务器不支持 Range(返回 200)则从头下载
    let dir = update_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let asset_path = dir.join(&asset_name);
    let resume_from = std::fs::metadata(&asset_path).map(|m| m.len()).unwrap_or(0);
    let mut req = http.get(&asset_url).header("Accept", "application/octet-stream");
    if resume_from > 0 {
        req = req.header("Range", format!("bytes={resume_from}-"));
    }
    let resp = req
        .timeout(std::time::Duration::from_secs(600))
        .send()
        .await
        .map_err(|e| format!("下载失败: {e}"))?;

    let mut received: u64 = 0;
    let mut append = false;
    if resume_from > 0 && resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        received = resume_from;
        append = true;
    } else if !resp.status().is_success() {
        return Err(format!("下载失败: GitHub 返回 {}", resp.status()));
    }
    let total = resp.content_length().map(|n| n + received);
    let mut file = if append {
        std::fs::OpenOptions::new()
            .append(true)
            .open(&asset_path)
            .map_err(|e| e.to_string())?
    } else {
        std::fs::File::create(&asset_path).map_err(|e| e.to_string())?
    };

    let mut last_emitted: u64 = 0;
    let mut last_tick = std::time::Instant::now();
    let emit = |received: u64, total: Option<u64>| {
        let _ = app.emit(
            UPDATE_PROGRESS,
            json!({ "received": received, "total": total, "name": asset_name, "version": latest }),
        );
    };
    emit(received, total);
    let mut stream = resp;
    while let Some(chunk) = stream.chunk().await.map_err(|e| format!("下载失败: {e}"))? {
        // 暂停:保留断点返回;取消:清理残留后中止(前端识别 update-cancelled 静默回到初始态)
        if state.update_cancel.load(Ordering::SeqCst) {
            drop(file);
            let _ = std::fs::remove_file(&asset_path);
            return Err("update-cancelled".into());
        }
        if state.update_pause.load(Ordering::SeqCst) {
            let _ = file.flush();
            drop(file);
            emit(received, total);
            return Ok(UpdateDownloadResult { version: latest, asset_name, paused: true });
        }
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        // 每 256KB 或每 250ms 广播一次,兼顾事件风暴与低速连接下的进度刷新
        if received - last_emitted >= 256 * 1024 || last_tick.elapsed() >= std::time::Duration::from_millis(250) {
            last_emitted = received;
            last_tick = std::time::Instant::now();
            emit(received, total);
        }
    }

    // 4. 完整性校验:已知总大小时长度不符即删除半包重来(避免越续越坏)
    if let Some(t) = total {
        if received != t {
            drop(file);
            let _ = std::fs::remove_file(&asset_path);
            return Err("下载不完整,请重试".into());
        }
    }
    emit(received, total);

    // 5. 生成更新向导脚本与任务文件,等待「重启并更新」拉起
    write_update_helper(&asset_path, &latest)?;
    write_update_task(&UpdateTask { version: latest.clone(), asset_name: asset_name.clone() })?;

    Ok(UpdateDownloadResult { version: latest, asset_name, paused: false })
}

/// 暂停当前下载:下载循环看到标志后收尾返回(断点保留)
#[tauri::command]
pub fn update_pause(state: State<'_, AppState>, window: tauri::WebviewWindow) -> Result<(), String> {
    ensure_main(&window)?;
    use std::sync::atomic::Ordering;
    state.update_pause.store(true, Ordering::SeqCst);
    Ok(())
}

/// 取消下载/放弃已就绪的更新:通知下载循环中止(进行中时由循环删除半成品),
/// 并清理任务文件、向导脚本与任务指名的更新包
#[tauri::command]
pub fn update_cancel(state: State<'_, AppState>, window: tauri::WebviewWindow) -> Result<(), String> {
    ensure_main(&window)?;
    use std::sync::atomic::Ordering;
    state.update_cancel.store(true, Ordering::SeqCst);
    let dir = update_dir();
    let task = read_update_task();
    remove_task_files(&dir, task.as_ref());
    // 进行中的半成品(任务文件尚未落盘时是唯一的删除线索)
    if let Ok(mut guard) = state.update_asset.lock() {
        if let Some(name) = guard.take() {
            let _ = std::fs::remove_file(dir.join(&name));
        }
    }
    Ok(())
}

/// 用户点击「重启并更新」:复核任务与安装包、生成向导脚本,拉起更新向导。
/// Windows 上应用不自行退出、也不隐藏窗口 —— 持续轮询向导日志等待「窗体已
/// 显示」就绪标记(最多 10 秒),期间向导若退出则捕获其输出落盘诊断后以具体
/// 原因报错;窗体就绪后由向导在「关闭 Plainstruct」阶段关闭应用并继续安装。
/// 此前的固定延时存活粗判把「脚本解析错误」「杀毒软件拦截」等秒退一律报成
/// 「请重试」,失败原因无从排查;现在所有失败路径都有落盘的可查线索。
/// macOS 上向导经 open 拉起、进程完全独立,沿用应用先退出的时序。
#[tauri::command]
pub fn update_restart_and_install(app: AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    ensure_main(&window)?;
    let dir = update_dir();
    let task = read_update_task().ok_or("没有待执行的更新任务")?;
    let asset_path = dir.join(&task.asset_name);
    if !asset_path.exists() {
        return Err("更新包不存在,请重新下载".into());
    }
    write_update_helper(&asset_path, &task.version)?;

    #[cfg(target_os = "windows")]
    {
        // 应用自身不再退出、也不再隐藏窗口:窗体就绪前保持可见可重试,
        // 向导就绪后会在「关闭 Plainstruct」阶段结束本进程
        let _ = &app;
        let mut child = spawn_update_helper_windows()?;
        let log_path = dir.join(UPDATE_LOG_FILE);
        // 就绪判定:轮询向导日志等待「窗体已显示」标记 —— 脚本解析通过、WinForms
        // 加载完成、窗体真正出现在屏幕上之后才会写入。期间向导进程若退出,或日志
        // 报告窗体建成前失败,均收集具体输出与日志后报错(此前按 1.5 秒存活粗判,
        // 秒退只提示「请重试」,解析错误/杀毒拦截等真实原因完全不落盘,连修数版
        // 无从定位)。
        let mut ready = false;
        let mut exited = false;
        let mut wizard_failed = false;
        for _ in 0..100 {
            if child.try_wait().map_or(false, |s| s.is_some()) {
                exited = true;
                break;
            }
            match std::fs::read_to_string(&log_path) {
                Ok(s) if s.contains(READY_MARKER) => {
                    ready = true;
                    break;
                }
                Ok(s) if s.contains("更新失败") => {
                    // 窗体尚未建成的失败:向导自身会以系统弹窗展示错误
                    wizard_failed = true;
                    break;
                }
                _ => {}
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        if !ready && !exited && !wizard_failed {
            // 10 秒未就绪但进程仍在:极慢环境(信任其继续运行,向导内部失败均可见)
            ready = child.try_wait().map_or(true, |s| s.is_none());
        }
        if wizard_failed {
            return Err(format!(
                "更新向导启动失败,系统弹窗中有具体原因。详情见日志:{}",
                log_path.display()
            ));
        }
        if !ready {
            // 向导进程启动后立即退出:读取其输出与日志,落盘诊断并带原因报错
            let mut stderr_text = String::new();
            if let Some(mut se) = child.stderr.take() {
                use std::io::Read;
                let _ = se.read_to_string(&mut stderr_text);
            }
            let hint = if stderr_text.trim().is_empty() {
                "PowerShell 无任何输出,常见为杀毒软件拦截了脚本执行。".to_string()
            } else {
                format!("PowerShell 报错:{}", truncate_chars(&stderr_text, 200))
            };
            let diag = format!(
                "[应用] 向导进程启动后立即退出,窗体未显示。{hint} 请在杀毒软件中放行该脚本,或在资源管理器中右键 update-helper.ps1 选择「使用 PowerShell 运行」手动重试。"
            );
            append_wizard_log(&dir, &diag);
            return Err(format!("{hint} 详情见日志:{}", log_path.display()));
        }
        // 窗体已显示(或极慢环境仍在运行):一切交由向导 —— 它会在「关闭 Plainstruct」
        // 阶段结束本进程并继续安装;失败路径均由向导界面与日志呈现,应用保持可用
    }

    #[cfg(target_os = "macos")]
    {
        spawn_update_helper_macos()?;
        // 向导独立于应用进程组,应用退出不影响其运行(其内部会等待应用退出)
        app.exit(0);
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = app;
        Err("当前平台不支持自动更新".into())
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    Ok(())
}

/// 向导窗体就绪标记:脚本在 WinForms 窗体显示后写入日志,应用据此判断交接成功
#[cfg(target_os = "windows")]
const READY_MARKER: &str = "窗体已显示";

/// 应用侧诊断写入向导运行日志(与脚本共用一份,用户只需查看一处)
#[cfg(target_os = "windows")]
fn append_wizard_log(dir: &std::path::Path, msg: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(UPDATE_LOG_FILE))
    {
        let _ = writeln!(f, "{msg}");
    }
}

/// 截断长文本用于错误提示(按字符,避免切断多字节)
#[cfg(target_os = "windows")]
fn truncate_chars(s: &str, n: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= n {
        t.to_string()
    } else {
        format!("{}…", t.chars().take(n).collect::<String>())
    }
}

/// Windows:以独立进程拉起更新向导,返回子进程句柄供调用方确认其存活;
/// stdout/stderr 管道捕获,秒退时读取具体报错(解析错误/环境问题直接可见)
#[cfg(target_os = "windows")]
fn spawn_update_helper_windows() -> Result<std::process::Child, String> {
    let dir = update_dir();
    let script = dir.join(format!("{UPDATE_HELPER_FILE}.ps1"));
    if !script.exists() {
        return Err("更新向导脚本不存在".into());
    }
    use std::os::windows::process::CommandExt;
    // 优先用绝对路径定位 Windows PowerShell(PATH 被裁剪时仍可用)
    let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
    let powershell = std::path::Path::new(&system_root)
        .join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
    let powershell = if powershell.exists() {
        powershell
    } else {
        std::path::PathBuf::from("powershell")
    };
    // -STA:显式单线程单元,WinForms 所需;不依赖宿主默认值。
    // -NonInteractive:脚本意外触发交互请求时立即报错退出,而非隐形挂起。
    // CREATE_NO_WINDOW:不显示命令行窗口,但进程持有可用的(隐藏)控制台。
    // 此前用 DETACHED_PROCESS 使 PowerShell 完全无控制台,部分环境下其启动
    // 即失败退出(手动运行同一脚本正常)——改用 CREATE_NO_WINDOW 后启动环境
    // 与常规一致,向导界面照常独立显示。
    let spawn_with = |flags: u32| {
        std::process::Command::new(&powershell)
            .args([
                "-NoProfile",
                "-STA",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&script)
            .current_dir(&dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .creation_flags(flags)
            .spawn()
    };
    const PLAIN: u32 = 0x0800_0000 | 0x0000_0200; // CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
    const BREAKAWAY: u32 = 0x0100_0000; // CREATE_BREAKAWAY_FROM_JOB
    // 先尝试脱离父进程的作业对象:若应用进程处在「退出即杀」的作业里,
    // 向导可免于被连带终结;作业不允许脱离时创建失败,退回常规创建
    spawn_with(PLAIN | BREAKAWAY)
        .or_else(|_| spawn_with(PLAIN))
        .map_err(|e| format!("无法启动更新向导: {e}"))
}

/// macOS:以独立进程拉起终端里的更新向导
#[cfg(target_os = "macos")]
fn spawn_update_helper_macos() -> Result<(), String> {
    let dir = update_dir();
    let script = dir.join(format!("{UPDATE_HELPER_FILE}.command"));
    if !script.exists() {
        return Err("更新向导脚本不存在".into());
    }
    std::process::Command::new("open")
        .args(["-a", "Terminal", &script.to_string_lossy()])
        .spawn()
        .map_err(|e| format!("无法启动更新向导: {e}"))?;
    Ok(())
}

/// 生成更新向导脚本(路径与版本在生成时嵌入,向导无需解析任务文件)。
/// Windows 脚本以 UTF-8 BOM 落盘:PowerShell 5.1 按系统 ANSI 编码读取无 BOM
/// 的脚本,中文界面会变乱码。
fn write_update_helper(asset_path: &std::path::Path, latest_version: &str) -> Result<(), String> {
    let dir = update_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        let current_version = env!("CARGO_PKG_VERSION");
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let app_dir = exe.parent().ok_or("无法定位程序目录")?.to_string_lossy().to_string();
        let app_exe = exe.to_string_lossy().to_string();
        let proc_name = exe
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "plainstruct".into());
        let q = |s: &str| s.replace('\'', "''");
        let script = WIN_WIZARD_SCRIPT
            .replace("__ASSET__", &q(&asset_path.to_string_lossy()))
            .replace("__APP_EXE__", &q(&app_exe))
            .replace("__APP_DIR__", &q(&app_dir))
            .replace("__TASK__", &q(&dir.join(UPDATE_TASK_FILE).to_string_lossy()))
            .replace("__VER_OLD__", current_version)
            .replace("__VER_NEW__", latest_version)
            .replace("__PROC__", &q(&proc_name));
        // UTF-8 BOM:Windows PowerShell 5.1 据此正确解码中文
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(script.as_bytes());
        std::fs::write(dir.join(format!("{UPDATE_HELPER_FILE}.ps1")), bytes).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        // 旧 .app 位置:当前 exe 位于 <App>.app/Contents/MacOS/<bin>,向上三级即 bundle;
        // 找不到时(开发模式)退回 /Applications 的标准位置
        let app_path = std::env::current_exe()
            .ok()
            .and_then(|exe| {
                exe.parent() // MacOS
                    .and_then(|p| p.parent()) // Contents
                    .and_then(|p| p.parent()) // <App>.app
                    .filter(|p| p.extension().map_or(false, |e| e == "app"))
                    .map(|p| p.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| "/Applications/Plainstruct.app".to_string());
        let script = MAC_WIZARD_SCRIPT
            .replace("__APP_PATH__", &app_path.replace('\'', "'\\''"))
            .replace("__DMG__", &asset_path.to_string_lossy().replace('\'', "'\\''"))
            .replace("__VER_NEW__", latest_version);
        let path = dir.join(format!("{UPDATE_HELPER_FILE}.command"));
        std::fs::write(&path, script).map_err(|e| e.to_string())?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (asset_path, latest_version);
        Err("当前平台不支持自动更新".into())
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    Ok(())
}

/// Windows 更新向导(WinForms):阶段清单 + 逐条目解压的真实进度 + 失败可见,
/// 中文经 UTF-8 BOM 正确显示。以 __TOKEN__ 占位替换,避免 format! 与
/// PowerShell 花括号互相干扰。仅取文件条目,剥离公共顶层目录后按字节加权
/// 展示进度,并防范压缩包内路径逃逸。整个脚本包在 try/catch 内:窗体建成前
/// 的失败回退为系统弹窗提示(此前这段出错会因无控制台而完全静默),
/// 全程写运行日志 update-wizard-log.txt,成功结束自动删除。
/// 应用进程由向导在阶段 1 主动结束(应用拉起向导后不再自行退出)。
#[cfg(target_os = "windows")]
const WIN_WIZARD_SCRIPT: &str = r#"$ErrorActionPreference = 'Stop'

# 运行日志:与脚本同目录(即更新任务目录),成功结束自动删除。
# 向导窗口若未出现,看这份日志即可判断脚本执行到了哪一步。
$logPath = Join-Path (Split-Path -Parent $PSCommandPath) 'update-wizard-log.txt'
function Write-Log([string]$msg) {
  try { [System.IO.File]::AppendAllText($logPath, ("[{0}] {1}`r`n" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)) } catch {}
}

# 首条日志写在 try 之前:此后任何阶段(含窗体建成前的失败)都能留下痕迹;
# 若连这份日志都没有,说明脚本未被执行(被拦截)或解析失败(应用侧会记录 PowerShell 输出)
Write-Log ("向导启动,PowerShell " + $PSVersionTable.PSVersion.ToString())

$installer = '__ASSET__'
$appExe    = '__APP_EXE__'
$appDir    = '__APP_DIR__'
$taskFile  = '__TASK__'
$verOld    = '__VER_OLD__'
$verNew    = '__VER_NEW__'

$zip = $null
try {
  Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class DpiHelper { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
  [DpiHelper]::SetProcessDPIAware() | Out-Null
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.Windows.Forms.Application]::EnableVisualStyles()

  $accent = [System.Drawing.Color]::FromArgb(15, 98, 254)
  $okC    = [System.Drawing.Color]::FromArgb(10, 122, 61)
  $badC   = [System.Drawing.Color]::FromArgb(192, 43, 43)
  $muted  = [System.Drawing.Color]::FromArgb(130, 130, 130)

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Plainstruct 更新'
  $form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
  $form.ClientSize = New-Object System.Drawing.Size(412, 224)
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.TopMost = $true

  $verLabel = New-Object System.Windows.Forms.Label
  $verLabel.Text = "正在更新 Plainstruct:v$verOld → v$verNew"
  $verLabel.AutoSize = $true
  $verLabel.Location = New-Object System.Drawing.Point(20, 16)
  $form.Controls.Add($verLabel)

  $stages = @('关闭 Plainstruct', '校验更新包', '解压并安装新版本', '启动新版本')
  $script:states = @(0, 0, 0, 0)
  $stageLabels = @()
  for ($i = 0; $i -lt $stages.Count; $i++) {
    $l = New-Object System.Windows.Forms.Label
    $l.AutoSize = $true
    $l.Location = New-Object System.Drawing.Point(22, (50 + $i * 26))
    $form.Controls.Add($l)
    $stageLabels += $l
  }
  $regular = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
  $bold    = New-Object System.Drawing.Font('Microsoft YaHei UI', 9, [System.Drawing.FontStyle]::Bold)

  function Update-Stages {
    for ($i = 0; $i -lt $stages.Count; $i++) {
      $icon = [char]0x25CB
      $color = $muted
      $font = $regular
      switch ($script:states[$i]) {
        1 { $icon = [char]0x25CF; $color = $accent; $font = $bold }
        2 { $icon = [char]0x2713; $color = $okC }
        3 { $icon = [char]0x2715; $color = $badC; $font = $bold }
      }
      $stageLabels[$i].Text = "$icon  $($stages[$i])"
      $stageLabels[$i].ForeColor = $color
      $stageLabels[$i].Font = $font
    }
    [System.Windows.Forms.Application]::DoEvents()
  }

  $bar = New-Object System.Windows.Forms.ProgressBar
  $bar.Location = New-Object System.Drawing.Point(20, 160)
  $bar.Size = New-Object System.Drawing.Size(372, 10)
  $form.Controls.Add($bar)

  $pctLabel = New-Object System.Windows.Forms.Label
  $pctLabel.AutoSize = $true
  $pctLabel.Location = New-Object System.Drawing.Point(20, 178)
  $pctLabel.ForeColor = $muted
  $pctLabel.Text = ''
  $form.Controls.Add($pctLabel)

  $closeBtn = New-Object System.Windows.Forms.Button
  $closeBtn.Text = '关闭'
  $closeBtn.Size = New-Object System.Drawing.Size(88, 26)
  $closeBtn.Location = New-Object System.Drawing.Point(304, 178)
  $closeBtn.Visible = $false
  $closeBtn.Add_Click({ $form.Close() })
  $form.Controls.Add($closeBtn)

  function Set-Stage([int]$idx) {
    Write-Log ("阶段: " + $stages[$idx])
    if ($idx -gt 0) { $script:states[$idx - 1] = 2 }
    $script:states[$idx] = 1
    Update-Stages
  }

  function Show-Fail([string]$msg) {
    Write-Log ("更新失败: " + $msg)
    try {
      $cur = [Array]::IndexOf($script:states, 1)
      if ($cur -ge 0) { $script:states[$cur] = 3 }
      $verLabel.Text = "更新失败:$msg"
      $verLabel.ForeColor = $badC
      $bar.Visible = $false
      $pctLabel.Visible = $false
      $closeBtn.Visible = $true
      Update-Stages
      while (-not $form.IsDisposed) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 60
      }
    } catch {}
    # 窗体尚未建成或不可用:退回系统弹窗,失败必须可见
    try {
      (New-Object -ComObject WScript.Shell).Popup(("更新失败:$msg`r`n详情见日志:$logPath"), 0, 'Plainstruct 更新', 16) | Out-Null
    } catch {}
    exit 1
  }

  $form.Show()
  # 窗体就绪标记:应用轮询日志等待此行,出现后才认为「应用已交给向导」
  Write-Log "窗体已显示"
  Update-Stages

  # 阶段 1:由向导关闭应用(应用拉起向导后保持运行、窗口可见,退出流程由向导
  # 负责)。先请求优雅关闭(等效点击窗口关闭按钮,应用可完成收尾),5 秒不退
  # 再强制结束,仍不退则报错;全程约宽限 15 秒
  Set-Stage 0
  $proc = Get-Process -Name '__PROC__' -ErrorAction SilentlyContinue
  if ($proc) {
    try { $proc | ForEach-Object { $null = $_.CloseMainWindow() }; Write-Log "已请求应用关闭" }
    catch { Write-Log ("请求应用关闭失败: " + $_.Exception.Message) }
    for ($i = 0; $i -lt 20; $i++) {
      if (-not (Get-Process -Name '__PROC__' -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 250
      [System.Windows.Forms.Application]::DoEvents()
    }
    if (Get-Process -Name '__PROC__' -ErrorAction SilentlyContinue) {
      Write-Log "应用未响应关闭请求,改为强制结束"
      try { $proc | Stop-Process -Force -ErrorAction Stop }
      catch { Write-Log ("强制结束失败: " + $_.Exception.Message) }
      for ($i = 0; $i -lt 40; $i++) {
        if (-not (Get-Process -Name '__PROC__' -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 250
        [System.Windows.Forms.Application]::DoEvents()
      }
      if (Get-Process -Name '__PROC__' -ErrorAction SilentlyContinue) {
        throw '无法关闭 Plainstruct,请手动退出应用后重试。'
      }
    }
    Write-Log "应用已退出"
  }
  Start-Sleep -Milliseconds 600

  # 阶段 2:校验更新包
  Set-Stage 1
  if (-not (Test-Path -LiteralPath $installer)) { throw '找不到更新包,请回到应用重新下载。' }
  $zip = [System.IO.Compression.ZipFile]::OpenRead($installer)
  $entries = @($zip.Entries | Where-Object { $_.FullName -and -not $_.FullName.EndsWith('/') })
  Write-Log ("更新包条目 " + $entries.Count + " 个")

  # 官方包内含一层文件夹:全部条目共享同一顶层目录时剥离
  $prefix = ''
  if ($entries.Count -gt 0) {
    $first = $entries[0].FullName.Replace('\', '/')
    $slash = $first.IndexOf('/')
    if ($slash -ge 0) {
      $cand = $first.Substring(0, $slash + 1)
      $same = $true
      foreach ($e in $entries) {
        if (-not $e.FullName.Replace('\', '/').StartsWith($cand)) { $same = $false; break }
      }
      if ($same) { $prefix = $cand }
    }
  }
  $totalBytes = [long]0
  foreach ($e in $entries) { $totalBytes += $e.Length }
  if ($totalBytes -le 0) { $totalBytes = 1 }
  $appDirBase = [System.IO.Path]::GetFullPath($appDir).TrimEnd('\') + '\'

  # 阶段 3:逐条目解压并覆盖安装,按字节加权展示真实进度
  Set-Stage 2
  $done = [long]0
  foreach ($e in $entries) {
    $rel = $e.FullName.Replace('\', '/').Substring($prefix.Length).Replace('/', '\')
    if ($rel -eq '') { continue }
    $dest = [System.IO.Path]::GetFullPath((Join-Path $appDir $rel))
    if (-not $dest.StartsWith($appDirBase, [System.StringComparison]::OrdinalIgnoreCase)) { throw "压缩包含非法路径:$rel" }
    $parent = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $in = $e.Open()
    $out = [System.IO.File]::Create($dest)
    try { $in.CopyTo($out) } finally { $out.Dispose(); $in.Dispose() }
    $done += $e.Length
    $pct = [Math]::Min(100, [int]($done * 100 / $totalBytes))
    $bar.Value = $pct
    $pctLabel.Text = "正在安装 $pct%"
    [System.Windows.Forms.Application]::DoEvents()
  }
  $zip.Dispose()
  $zip = $null

  # 阶段 4:清理任务文件与更新包,启动新版本
  Set-Stage 3
  $bar.Value = 100
  Write-Log "更新完成"
  foreach ($f in @($taskFile, $installer, $PSCommandPath, $logPath)) {
    Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
  }
  Start-Process -FilePath $appExe -WorkingDirectory $appDir
  $pctLabel.Text = "更新完成,正在启动 v$verNew …"
  for ($i = 0; $i -lt 15; $i++) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 100
  }
  $form.Close()
} catch {
  if ($zip) { try { $zip.Dispose() } catch {} }
  Show-Fail $_.Exception.Message
}
"#;

/// macOS 更新向导(终端窗口即向导,按阶段显示进度,含按需的隔离修复)
#[cfg(target_os = "macos")]
const MAC_WIZARD_SCRIPT: &str = r#"#!/bin/bash
# Plainstruct 自动更新向导(终端窗口即向导,按阶段显示进度)
APP_PATH='__APP_PATH__'
DMG='__DMG__'
echo '── Plainstruct 更新 → v__VER_NEW__ ──'
echo '等待 Plainstruct 退出...'
while pgrep -x plainstruct >/dev/null 2>&1; do sleep 1; done
echo '挂载更新镜像...'
MOUNT=$(hdiutil attach -nobrowse -readonly "$DMG" 2>/dev/null | awk -F'\t' '/Volumes/{print $NF}' | head -1)
if [ -z "$MOUNT" ]; then
  echo '无法挂载更新镜像,更新已取消。'
  read -r -p '按回车键退出...'
  exit 1
fi
echo '正在安装新版本到 '"$APP_PATH"' ...'
rm -rf "$APP_PATH"
if ! cp -R "$MOUNT/Plainstruct.app" "$APP_PATH"; then
  echo '安装失败,请手动打开 dmg 拖入「应用程序」。'
  hdiutil detach "$MOUNT" 2>/dev/null
  read -r -p '按回车键退出...'
  exit 1
fi
hdiutil detach "$MOUNT" 2>/dev/null
echo '检查隔离标记(应用内下载通常没有,无需修复)...'
if xattr -p com.apple.quarantine "$APP_PATH" >/dev/null 2>&1; then
  echo '检测到隔离标记:正在移除,需要输入开机密码...'
  if sudo xattr -r -d com.apple.quarantine "$APP_PATH"; then
    echo '已移除隔离标记。'
  else
    echo '移除未完成:若打开时提示「已损坏」,请运行 dmg 内的「损坏修复.command」。'
  fi
else
  echo '未检测到隔离标记,无需修复。'
fi
echo '启动新版本...'
open "$APP_PATH"
echo '更新完成,本窗口可以关闭。'
read -r -p '按回车键退出...'
"#;
