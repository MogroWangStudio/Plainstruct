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
        return Err("请先填写用户名、仓库名与访问令牌".into());
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
    if repo_status == 404 {
        if !cfg.auto_create {
            return Err(format!("仓库 {}/{} 不存在", cfg.owner, cfg.repo));
        }
        emit_log(app, "info", "仓库不存在,正在自动创建…");
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
        emit_log(app, "info", "仓库已创建");
    } else if repo_status != 200 {
        return Err(format!("访问仓库失败({repo_status})"));
    }

    let branch_ref = format!("refs/heads/{}", cfg.branch);
    // 引用查询/更新用 heads/{branch} 形式(GitHub 文档用法)。实测完整形式
    // refs%2Fheads%2F{branch} 对已存在的分支也返回 404,会导致增量发布被
    // 误判为「分支不存在」而走创建,进而撞上 422 reference already exists
    let ref_url = repo_api(&cfg, &format!("/git/ref/heads/{}", cfg.branch.replace('/', "%2F")));

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
        emit_log(app, "info", "仓库为空,正在初始化发布分支…");
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
        let (ref_status, ref_body) = request(
            &http,
            reqwest::Method::PATCH,
            &ref_url,
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
                &ref_url,
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

    // 7. 尽力开启 Pages(失败不影响发布结果)
    let (pages_status, _) = request(&http, reqwest::Method::GET, &repo_api(&cfg, "/pages"), &cfg.token, None).await?;
    if pages_status == 404 {
        emit_log(app, "info", "首次发布:正在开启 GitHub Pages…");
        let _ = request(
            &http,
            reqwest::Method::POST,
            &repo_api(&cfg, "/pages"),
            &cfg.token,
            Some(json!({ "source": { "branch": cfg.branch, "path": "/" } })),
        )
        .await?;
        emit_log(app, "info", "GitHub Pages 已开启(指向发布分支)");
    } else {
        emit_log(app, "info", "GitHub Pages 已开启,跳过");
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

/// 更新任务目录:安装包、向导脚本都放在这里。应用正常启动时会清空此目录,
/// 因此「目录内存在向导脚本」即表示「用户已下载更新、等待退出后执行向导」。
pub(crate) fn update_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("plainstruct-update")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadResult {
    pub version: String,
    pub asset_name: String,
}

/// 从官方仓库最新 Release 下载当前平台对应的安装包,并生成更新向导脚本。
/// 下载完成即万事俱备:用户关闭应用后由退出钩子拉起向导完成安装并重启。
#[tauri::command]
pub async fn update_download(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<UpdateDownloadResult, String> {
    use crate::events::UPDATE_PROGRESS;

    ensure_main(&window)?;
    let http = state.http.clone();
    let current = env!("CARGO_PKG_VERSION").to_string();

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

    // 2. 选择当前平台的安装包:便携版(marker 标记)用 zip 解压覆盖,安装版用 NSIS 静默安装
    let portable = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("portable.marker").exists()))
        .unwrap_or(false);
    let want = |name: &str, suffix: &str| -> bool {
        let n = name.to_ascii_lowercase();
        #[cfg(target_os = "windows")]
        {
            n.ends_with(suffix) && n.contains("x64")
                && if portable { n.contains("portable") } else { n.contains("setup") }
        }
        #[cfg(target_os = "macos")]
        {
            let _ = (name, suffix, portable);
            n.ends_with(".dmg")
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            let _ = (n, suffix, portable);
            false
        }
    };
    let asset = body["assets"]
        .as_array()
        .and_then(|list| {
            list.iter()
                .find(|a| want(a["name"].as_str().unwrap_or(""), ".exe") || want(a["name"].as_str().unwrap_or(""), ".dmg"))
        })
        .ok_or("Release 中没有当前平台的安装包")?;
    let asset_name = asset["name"].as_str().unwrap_or("").to_string();
    let asset_url = asset["browser_download_url"].as_str().unwrap_or("").to_string();
    if asset_url.is_empty() {
        return Err("安装包下载地址缺失".into());
    }

    // 3. 流式下载,进度经事件广播
    let dir = update_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let asset_path = dir.join(&asset_name);
    let resp = http
        .get(&asset_url)
        .header("Accept", "application/octet-stream")
        .timeout(std::time::Duration::from_secs(600))
        .send()
        .await
        .map_err(|e| format!("下载失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败: GitHub 返回 {}", resp.status()));
    }
    let total = resp.content_length();
    let mut file = std::fs::File::create(&asset_path).map_err(|e| e.to_string())?;
    use std::io::Write;
    let mut received: u64 = 0;
    let mut last_emitted: u64 = 0;
    let mut stream = resp;
    while let Some(chunk) = stream.chunk().await.map_err(|e| format!("下载失败: {e}"))? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        // 每 256KB 或到达尾部时广播一次,避免事件风暴
        if received - last_emitted >= 256 * 1024 || total.map_or(false, |t| received >= t) {
            last_emitted = received;
            let _ = app.emit(
                UPDATE_PROGRESS,
                json!({ "received": received, "total": total }),
            );
        }
    }
    let _ = file.flush();

    // 4. 生成平台对应的更新向导脚本,退出钩子据此拉起
    write_update_helper(&asset_path, portable)?;

    Ok(UpdateDownloadResult {
        version: latest,
        asset_name,
    })
}

/// 生成更新向导脚本(路径全部在生成时嵌入,向导无需解析任务文件)
fn write_update_helper(asset_path: &std::path::Path, portable: bool) -> Result<(), String> {
    let dir = update_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let asset = asset_path.to_string_lossy().replace('\'', "''");

    #[cfg(target_os = "windows")]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let app_dir = exe.parent().ok_or("无法定位程序目录")?.to_string_lossy().replace('\'', "''");
        let app_exe = exe.to_string_lossy().replace('\'', "''");
        let script = format!(
            r#"$ErrorActionPreference = 'Stop'
$installer = '{asset}'
$appExe    = '{app_exe}'
$appDir    = '{app_dir}'
$portable  = '{portable}'

Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Plainstruct 更新'
$form.Size = New-Object System.Drawing.Size(380,150)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.TopMost = $true
$label = New-Object System.Windows.Forms.Label
$label.Dock = 'Fill'
$label.TextAlign = 'MiddleCenter'
$label.Text = '准备更新...'
$form.Controls.Add($label)
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Style = 'Marquee'
$bar.MarqueeAnimationSpeed = 30
$bar.Dock = 'Bottom'
$bar.Height = 22
$form.Controls.Add($bar)
$form.Show()
function Set-Stage($t) {{ $label.Text = $t; [System.Windows.Forms.Application]::DoEvents() }}

Set-Stage '等待 Plainstruct 退出...'
try {{ Wait-Process -Name 'plainstruct' -Timeout 30 -ErrorAction Stop }} catch {{}}
Start-Sleep -Milliseconds 800

if ($portable -eq 'true') {{
  Set-Stage '正在解压并更新程序文件...'
  $tmp = Join-Path $env:TEMP ('plainstruct-unzip-' + [guid]::NewGuid().ToString())
  Expand-Archive -Path $installer -DestinationPath $tmp -Force
  $src = (Get-ChildItem $tmp | Select-Object -First 1).FullName
  Copy-Item -Path (Join-Path $src '*') -Destination $appDir -Recurse -Force
  Remove-Item -LiteralPath $tmp -Recurse -Force
}} else {{
  Set-Stage '正在运行安装程序,请稍候...'
  $nsisArgs = '/S /D=' + $appDir
  Start-Process -FilePath $installer -ArgumentList $nsisArgs -Wait | Out-Null
}}

Set-Stage '启动新版本...'
Start-Process -FilePath $appExe
$form.Close()
"#,
            asset = asset,
            app_exe = app_exe,
            app_dir = app_dir,
            portable = if portable { "true" } else { "false" },
        );
        std::fs::write(dir.join("update-helper.ps1"), script).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        let _ = portable;
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
        let app_path = app_path.replace('\'', "'\\''");
        let dmg = asset;
        let script = format!(
            r#"#!/bin/bash
# Plainstruct 自动更新向导(终端窗口即向导,按阶段显示进度)
APP_PATH='{app_path}'
DMG='{dmg}'
echo '── Plainstruct 更新 ──'
echo '等待 Plainstruct 退出...'
while pgrep -x plainstruct >/dev/null 2>&1; do sleep 1; done
echo '挂载更新镜像...'
MOUNT=$(hdiutil attach -nobrowse -readonly "$DMG" 2>/dev/null | awk -F'\t' '/Volumes/{{print $NF}}' | head -1)
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
"#,
            app_path = app_path,
            dmg = dmg,
        );
        let path = dir.join("update-helper.command");
        std::fs::write(&path, script).map_err(|e| e.to_string())?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (asset_path, portable);
        Err("当前平台不支持自动更新".into())
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    Ok(())
}
