/** GitHub Pages 同步 -- REST + Git Data API,整站单次原子提交,无需本地 Git */
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::commands::app::now_millis;
use crate::commands::build::collect_build_files;
use crate::events::SYNC_PROGRESS;
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
}

fn default_branch() -> String {
    "gh-pages".into()
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
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

/// 统一请求:返回 (状态码, 响应 JSON)
async fn request(
    http: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    token: &str,
    body: Option<Value>,
) -> Result<(u16, Value), String> {
    let mut req = http
        .request(method, url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
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
        return Ok(VerifyResult {
            ok: false,
            message: Some("invalid-token".into()),
            user: None,
            repo_exists: None,
            pages_enabled: None,
        });
    }

    let (status, user) = request(&http, reqwest::Method::GET, &format!("{API}/user"), &cfg.token, None).await?;
    if status == 401 || status == 403 {
        return Ok(VerifyResult {
            ok: false,
            message: Some("invalid-token".into()),
            user: None,
            repo_exists: None,
            pages_enabled: None,
        });
    }
    if status != 200 {
        return Err(format!("GitHub 返回 {status}"));
    }
    let login = user["login"].as_str().unwrap_or("").to_string();

    let (repo_status, _) = request(
        &http,
        reqwest::Method::GET,
        &repo_api(&cfg, ""),
        &cfg.token,
        None,
    )
    .await?;
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
        let ref_url = repo_api(&cfg, &format!("/git/ref/refs/heads/{}", cfg.branch.replace('/', "%2F")));
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

#[tauri::command]
pub async fn github_sync(
    window: tauri::WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    cfg: GithubConfig,
) -> Result<SyncResult, String> {
    ensure_main(&window)?;
    if cfg.token.is_empty() || cfg.owner.is_empty() || cfg.repo.is_empty() {
        return Err("请先填写用户名、仓库名与访问令牌".into());
    }
    let root = state.site_root()?;
    let files = collect_build_files(&root)?;
    if files.is_empty() {
        return Err("构建目录为空,请先构建站点".into());
    }
    let http = state.http.clone();
    let total = files.len() as u32;

    // 1. 校验令牌
    let (status, _) = request(&http, reqwest::Method::GET, &format!("{API}/user"), &cfg.token, None).await?;
    if status == 401 || status == 403 {
        return Err("invalid-token".into());
    }

    // 2. 确保仓库存在
    let (repo_status, _) = request(&http, reqwest::Method::GET, &repo_api(&cfg, ""), &cfg.token, None).await?;
    if repo_status == 404 {
        if !cfg.auto_create {
            return Err(format!("仓库 {}/{} 不存在", cfg.owner, cfg.repo));
        }
        let (create_status, create_body) = request(
            &http,
            reqwest::Method::POST,
            &format!("{API}/user/repos"),
            &cfg.token,
            // auto_init:完全空仓库无法通过 Git API 创建首个分支引用(会 409),
            // 让 GitHub 自带初始提交把仓库初始化
            Some(json!({ "name": cfg.repo, "private": false, "auto_init": true })),
        )
        .await?;
        if create_status != 201 && create_status != 202 {
            let msg = create_body["message"].as_str().unwrap_or("");
            return Err(format!("创建仓库失败({create_status}): {msg}"));
        }
    } else if repo_status != 200 {
        return Err(format!("访问仓库失败({repo_status})"));
    }

    let branch_ref = format!("refs/heads/{}", cfg.branch);
    let ref_url = repo_api(&cfg, &format!("/git/ref/{}", branch_ref.replace('/', "%2F")));

    // 3. 取基准提交。分支不存在时不预建空树(Git API 拒绝空 tree 数组,会 422),
    //    直接以本次站点提交(无 parents)作为发布分支的初始提交,提交后再创建 ref。
    //    完全空仓库(无任何提交)的 ref 查询返回 409「Git Repository is empty」,
    //    且 Git API 无法在空仓库直接创建 ref:先用 Contents API 在发布分支放入
    //    种子文件生成初始提交,再以该提交为基准发布(站点提交随后全量替换种子文件)
    let (ref_status, ref_body) = request(&http, reqwest::Method::GET, &ref_url, &cfg.token, None).await?;
    let mut base_commit: Option<String> = None;
    let mut branch_exists = false;
    if ref_status == 200 {
        base_commit = ref_body["object"]["sha"].as_str().map(|s| s.to_string());
        branch_exists = true;
    } else if ref_status == 409 {
        let (seed_status, seed_body) = request(
            &http,
            reqwest::Method::PUT,
            &repo_api(&cfg, "/contents/plainstruct-init.md"),
            &cfg.token,
            Some(json!({
                "message": "plainstruct: init publish branch",
                "content": B64.encode(b"# Plainstruct\n\nThis branch is published by Plainstruct. Site content replaces this file on first publish.\n"),
                "branch": cfg.branch,
            })),
        )
        .await?;
        if seed_status != 201 && seed_status != 200 {
            let msg = seed_body["message"].as_str().unwrap_or("");
            return Err(format!("初始化发布分支失败({seed_status}): {msg}"));
        }
        // 种子提交已创建发布分支,重新取基准;此后走常规的分支更新路径
        let (ref_status, ref_body) = request(&http, reqwest::Method::GET, &ref_url, &cfg.token, None).await?;
        if ref_status == 200 {
            base_commit = ref_body["object"]["sha"].as_str().map(|s| s.to_string());
            branch_exists = true;
        }
    }

    // 4. 逐文件建 blob(全量替换,天然处理删除)。增量:先取云端现有 tree 的
    //    path -> blob sha 映射,内容未变化的文件直接复用云端 blob,不再重复上传
    let mut remote_shas: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if let Some(base) = &base_commit {
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
    for (i, (path, bytes)) in files.iter().enumerate() {
        let local_sha = git_blob_sha(bytes);
        let sha = if remote_shas.get(path).map(|s| s.as_str()) == Some(local_sha.as_str()) {
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

    // 5. tree(不带 base_tree = 精确替换,自动清理已删除文件)-> commit -> 更新 ref
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

    // 6. 分支已存在则强推更新;首次发布则创建发布分支指向该提交
    if branch_exists {
        let (ref_status, ref_body) = request(
            &http,
            reqwest::Method::PATCH,
            &ref_url,
            &cfg.token,
            Some(json!({ "sha": commit_sha, "force": true })),
        )
        .await?;
        if ref_status != 200 {
            let msg = ref_body["message"].as_str().unwrap_or("");
            return Err(format!("更新分支失败({ref_status}): {msg}"));
        }
    } else {
        let (created, ref_body) = request(
            &http,
            reqwest::Method::POST,
            &repo_api(&cfg, "/git/refs"),
            &cfg.token,
            Some(json!({ "ref": branch_ref, "sha": commit_sha })),
        )
        .await?;
        if created != 201 {
            let msg = ref_body["message"].as_str().unwrap_or("");
            return Err(format!("创建发布分支失败({created}): {msg}"));
        }
    }

    // 7. 尽力开启 Pages(失败不影响发布结果)
    let (pages_status, _) = request(&http, reqwest::Method::GET, &repo_api(&cfg, "/pages"), &cfg.token, None).await?;
    if pages_status == 404 {
        let _ = request(
            &http,
            reqwest::Method::POST,
            &repo_api(&cfg, "/pages"),
            &cfg.token,
            Some(json!({ "source": { "branch": cfg.branch, "path": "/" } })),
        )
        .await?;
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
