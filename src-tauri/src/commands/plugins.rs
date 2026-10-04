/** 站点插件命令:用户导入插件的文件管理(.plainstruct/plugins/<id>/) */
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

use crate::fsutil::{safe_join, safe_name};
use crate::state::{ensure_main, AppState};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SitePluginEntry {
    pub id: String,
    pub name: String,
    pub files: Vec<String>,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SitePluginFile {
    pub name: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SitePluginFiles {
    pub id: String,
    pub name: String,
    pub files: Vec<SitePluginFile>,
}

fn plugins_root(root: &PathBuf) -> PathBuf {
    root.join(".plainstruct").join("plugins")
}

/// 站点内生效的插件是文本脚本与样式,只放行这两类
fn plugin_ext(path: &std::path::Path) -> Option<String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())?;
    if ext == "js" || ext == "css" {
        Some(ext)
    } else {
        None
    }
}

fn plugin_dir(root: &PathBuf, id: &str) -> Result<PathBuf, String> {
    safe_join(&plugins_root(root), id)
}

#[tauri::command]
pub fn import_site_plugin(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    src_paths: Vec<String>,
) -> Result<SitePluginEntry, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let sources: Vec<PathBuf> = src_paths.iter().map(PathBuf::from).collect();
    if sources.is_empty() {
        return Err("未选择插件文件".into());
    }
    for src in &sources {
        if plugin_ext(src).is_none() {
            return Err(format!("仅支持 .js 与 .css 文件: {}", src.display()));
        }
    }

    // 纳秒时间戳 + 进程号低位:同一毫秒内连续导入也不会撞 id
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let id = format!("plugin-{}-{}", nanos % 1_000_000, std::process::id() % 9973);
    let dir = plugin_dir(&root, &id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut files: Vec<String> = Vec::new();
    let mut name = String::new();
    for src in &sources {
        let original = src
            .file_name()
            .map(|s| safe_name(&s.to_string_lossy()))
            .unwrap_or_else(|| "plugin.js".into());
        let mut dest = dir.join(&original);
        let mut i = 2;
        while dest.exists() {
            // 同一批内(或历史遗留)的重名文件加序号,保持逐一可见
            let stem = src
                .file_stem()
                .map(|s| safe_name(&s.to_string_lossy()))
                .unwrap_or_else(|| "plugin".into());
            let ext = plugin_ext(src).unwrap_or_default();
            dest = dir.join(format!("{stem}-{i}.{ext}"));
            i += 1;
        }
        std::fs::copy(src, &dest).map_err(|e| format!("复制失败: {e}"))?;
        let stored = dest.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if name.is_empty() {
            name = src
                .file_stem()
                .map(|s| safe_name(&s.to_string_lossy()))
                .unwrap_or_else(|| stored.clone());
        }
        files.push(stored);
    }

    Ok(SitePluginEntry {
        id,
        name,
        files,
        enabled: true,
    })
}

#[tauri::command]
pub fn delete_site_plugin(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let dir = plugin_dir(&root, &id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 预览内联用:读取启用插件的文件内容(前端在 site.json 中持有条目清单)
#[tauri::command]
pub fn read_site_plugin_files(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    entries: Vec<SitePluginEntry>,
) -> Result<Vec<SitePluginFiles>, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let mut out = Vec::new();
    for entry in entries {
        let dir = plugin_dir(&root, &entry.id)?;
        let mut files = Vec::new();
        for rel in &entry.files {
            let full = safe_join(&dir, rel)?;
            let content = match std::fs::read_to_string(&full) {
                Ok(text) => text,
                // 单个文件缺失不阻断其余插件(文件被外部改动时的容错)
                Err(_) => continue,
            };
            files.push(SitePluginFile {
                name: rel.clone(),
                content,
            });
        }
        if !files.is_empty() {
            out.push(SitePluginFiles {
                id: entry.id,
                name: entry.name,
                files,
            });
        }
    }
    Ok(out)
}
