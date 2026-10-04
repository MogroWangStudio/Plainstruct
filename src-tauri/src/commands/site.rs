/** 站点命令:创建/打开/关闭、站点配置、logo */
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

use crate::commands::app::touch_recent;
use crate::commands::build::dir_size;
use crate::state::{ensure_main, AppState};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SiteThemeRef {
    pub id: String,
    pub source: String,
    pub config: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SiteConfig {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 站点内 logo:主题页头/侧栏展示,受主题的尺寸与圆角配置影响
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    /// 站点外图标(favicon):只用于浏览器标签页,不影响主题内的 logo
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favicon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_format: Option<String>,
    /// 站点类型:docs / blog,缺省 docs(兼容旧 site.json)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site_type: Option<String>,
    /// 站点插件:内置插件开关与用户导入的插件列表(结构与前端 SitePluginsConfig 对应)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugins: Option<serde_json::Value>,
    pub theme: SiteThemeRef,
}

impl Default for SiteConfig {
    fn default() -> Self {
        Self {
            name: "未命名站点".into(),
            description: None,
            logo: None,
            favicon: None,
            locale: None,
            title_format: None,
            site_type: None,
            plugins: None,
            theme: SiteThemeRef {
                id: "plain-light".into(),
                source: "builtin".into(),
                config: serde_json::json!({}),
            },
        }
    }
}

pub fn plainstruct_dir(root: &PathBuf) -> PathBuf {
    root.join(".plainstruct")
}

fn site_config_path(root: &PathBuf) -> PathBuf {
    plainstruct_dir(root).join("site.json")
}

pub fn read_site_config_file(root: &PathBuf) -> Result<SiteConfig, String> {
    let path = site_config_path(root);
    let text = std::fs::read_to_string(&path).map_err(|_| "not-a-site".to_string())?;
    let mut cfg: SiteConfig = serde_json::from_str(&text).map_err(|e| format!("site.json 解析失败: {e}"))?;
    // 规范化:空描述视为无描述
    if cfg.description.as_deref() == Some("") {
        cfg.description = None;
    }
    Ok(cfg)
}

fn write_site_config_file(root: &PathBuf, cfg: &SiteConfig) -> Result<(), String> {
    let dir = plainstruct_dir(root);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(site_config_path(root), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_site(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    dir: String,
    name: String,
    description: Option<String>,
    site_type: Option<String>,
) -> Result<SiteConfig, String> {
    ensure_main(&window)?;
    let root = PathBuf::from(&dir);
    if plainstruct_dir(&root).exists() {
        return Err("occupied".into());
    }
    let content = root.join("content");
    if content.exists() && std::fs::read_dir(&content).map(|mut d| d.next().is_some()).unwrap_or(false) {
        return Err("occupied".into());
    }

    std::fs::create_dir_all(root.join("content")).map_err(|e| e.to_string())?;
    // 站点资产统一存放处:插入图片时自动复制到这里,构建后原样出现在站点根
    std::fs::create_dir_all(root.join("content").join("asset")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(plainstruct_dir(&root).join("themes")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(plainstruct_dir(&root).join("assets")).map_err(|e| e.to_string())?;

    let title = name.trim();
    let site_type = site_type.filter(|t| t == "blog").unwrap_or_else(|| "docs".into());
    let welcome = if site_type == "blog" {
        format!(
            "---\ntitle: 首页\norder: 0\n---\n\n# {title}\n\n这里是你的博客。新建文章时在 front-matter 里写上 date,首页的文章流就会按日期排序展示。\n"
        )
    } else {
        format!(
            "---\ntitle: 首页\norder: 0\n---\n\n# {title}\n\n从这里开始写作。\n\n- 左侧文件树管理文档\n- 编辑与实时预览左右对照\n- 构建后可发布到 GitHub Pages\n"
        )
    };
    std::fs::write(root.join("content").join("index.md"), welcome).map_err(|e| e.to_string())?;

    // 博客站点默认使用首个内置博客主题(浅色),文档站点保持素构·浅色
    let theme_id = if site_type == "blog" { "blog-light" } else { "plain-light" };
    let cfg = SiteConfig {
        name: title.to_string(),
        description: description.filter(|d| !d.trim().is_empty()),
        site_type: Some(site_type),
        theme: SiteThemeRef {
            id: theme_id.into(),
            source: "builtin".into(),
            config: serde_json::json!({}),
        },
        ..Default::default()
    };
    write_site_config_file(&root, &cfg)?;

    // 默认 GitHub 配置
    let gh = serde_json::json!({ "owner": "", "repo": "", "branch": "gh-pages", "token": "", "autoCreate": true, "accountType": "user" });
    std::fs::write(plainstruct_dir(&root).join("github.json"), serde_json::to_string_pretty(&gh).unwrap())
        .map_err(|e| e.to_string())?;

    *state.site_root.lock().map_err(|e| e.to_string())? = Some(root.clone());
    touch_recent(&state, title, &dir);
    Ok(cfg)
}

#[tauri::command]
pub fn open_site(window: tauri::WebviewWindow, state: State<'_, AppState>, dir: String) -> Result<SiteConfig, String> {
    ensure_main(&window)?;
    let root = PathBuf::from(&dir);
    let cfg = read_site_config_file(&root)?;
    *state.site_root.lock().map_err(|e| e.to_string())? = Some(root);
    touch_recent(&state, &cfg.name, &dir);
    Ok(cfg)
}

#[tauri::command]
pub fn close_site(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    ensure_main(&window)?;
    *state.site_root.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn get_site_root(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<String, String> {
    ensure_main(&window)?;
    Ok(state.site_root()?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_site_config(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<SiteConfig, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    read_site_config_file(&root)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SiteConfigPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub favicon: Option<String>,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub title_format: Option<String>,
    #[serde(default)]
    pub site_type: Option<String>,
    #[serde(default)]
    pub plugins: Option<serde_json::Value>,
    #[serde(default)]
    pub theme: Option<SiteThemeRef>,
}

#[tauri::command]
pub fn save_site_config(window: tauri::WebviewWindow, state: State<'_, AppState>, patch: SiteConfigPatch) -> Result<SiteConfig, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let existing = read_site_config_file(&root)?;
    let cfg = SiteConfig {
        name: patch.name.unwrap_or(existing.name),
        description: match patch.description {
            Some(d) if d.is_empty() => None,
            Some(d) => Some(d),
            None => existing.description,
        },
        logo: patch.logo.or(existing.logo),
        favicon: patch.favicon.or(existing.favicon),
        locale: match patch.locale {
            Some(l) if l.trim().is_empty() => None,
            Some(l) => Some(l),
            None => existing.locale,
        },
        // 空字符串 = 清除格式,回退默认连接符
        title_format: match patch.title_format {
            Some(f) if f.trim().is_empty() => None,
            Some(f) => Some(f),
            None => existing.title_format,
        },
        site_type: match patch.site_type {
            Some(t) if t.trim().is_empty() => None,
            Some(t) => Some(t),
            None => existing.site_type,
        },
        // 插件配置由前端整体读写(完整对象),patch 携带时整体覆盖
        plugins: patch.plugins.or(existing.plugins),
        theme: patch.theme.unwrap_or(existing.theme),
    };
    write_site_config_file(&root, &cfg)?;
    Ok(cfg)
}

/// 站点图片(logo / favicon)统一落盘:按固定前缀命名,换图时清掉同前缀的旧文件
fn store_site_image(root: &PathBuf, src_path: &str, stem: &str) -> Result<String, String> {
    let src = PathBuf::from(src_path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| matches!(e.as_str(), "png" | "svg" | "jpg" | "jpeg" | "webp" | "ico" | "gif"))
        .ok_or("不支持的图片格式")?;
    let assets = plainstruct_dir(root).join("assets");
    std::fs::create_dir_all(&assets).map_err(|e| e.to_string())?;
    let stored = format!("{stem}.{ext}");
    std::fs::copy(&src, assets.join(&stored)).map_err(|e| e.to_string())?;
    // 同前缀但扩展名不同的旧图(如 logo.png 换成 logo.svg)一并清理,避免残留
    let prefix = format!("{stem}.");
    if let Ok(entries) = std::fs::read_dir(&assets) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name != stored && name.starts_with(&prefix) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    Ok(stored)
}

/// 清空配置中的图片引用并删除文件(引用不清会"复活")
fn clear_site_image(root: &PathBuf, stem: &str) -> Result<SiteConfig, String> {
    let mut cfg = read_site_config_file(root)?;
    let current = if stem == "favicon" { cfg.favicon.clone() } else { cfg.logo.clone() };
    if let Some(name) = current {
        let _ = std::fs::remove_file(plainstruct_dir(root).join("assets").join(&name));
    }
    if stem == "favicon" {
        cfg.favicon = None;
    } else {
        cfg.logo = None;
    }
    write_site_config_file(root, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
pub fn set_site_logo(window: tauri::WebviewWindow, state: State<'_, AppState>, src_path: String) -> Result<String, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    store_site_image(&root, &src_path, "logo")
}

#[tauri::command]
pub fn remove_site_logo(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<SiteConfig, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    clear_site_image(&root, "logo")
}

#[tauri::command]
pub fn set_site_favicon(window: tauri::WebviewWindow, state: State<'_, AppState>, src_path: String) -> Result<String, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    store_site_image(&root, &src_path, "favicon")
}

#[tauri::command]
pub fn remove_site_favicon(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<SiteConfig, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    clear_site_image(&root, "favicon")
}

/// 最近打开列表的站点摘要:类型与文件夹大小(只读;非素构站点目录报错)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBrief {
    pub site_type: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub fn get_site_info(window: tauri::WebviewWindow, path: String) -> Result<SiteBrief, String> {
    ensure_main(&window)?;
    let root = PathBuf::from(&path);
    let cfg = read_site_config_file(&root)?;
    Ok(SiteBrief {
        site_type: cfg.site_type.unwrap_or_else(|| "docs".into()),
        size_bytes: dir_size(&root),
    })
}
