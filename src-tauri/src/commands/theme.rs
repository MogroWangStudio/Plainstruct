/** 主题命令:自定义主题管理、ZIP 导入导出 */
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::State;

use crate::fsutil::{rel_posix, safe_join, safe_name, unique_path};
use crate::state::{ensure_main, AppState};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ThemeMeta {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub config: serde_json::Value,
    /// 主题适用的站点类型:docs / blog,缺省 docs(兼容旧自定义主题)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site_type: Option<String>,
    pub source: String,
}

fn themes_root(root: &PathBuf) -> PathBuf {
    root.join(".plainstruct").join("themes")
}

/// 目录名作为主题 id
fn theme_dir(root: &PathBuf, theme_id: &str) -> Result<PathBuf, String> {
    safe_join(&themes_root(root), theme_id)
}

fn meta_from_dir(dir: &PathBuf, id: &str) -> ThemeMeta {
    let json_path = dir.join("theme.json");
    let value: serde_json::Value = std::fs::read_to_string(&json_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null);
    ThemeMeta {
        id: id.to_string(),
        name: value["name"].as_str().unwrap_or(id).to_string(),
        version: value["version"].as_str().unwrap_or("0.0.0").to_string(),
        author: value["author"].as_str().map(|s| s.to_string()),
        description: value["description"].as_str().map(|s| s.to_string()),
        config: value["config"].clone(),
        site_type: value["type"].as_str().map(|s| s.to_string()),
        source: "custom".into(),
    }
}

#[tauri::command]
pub fn list_custom_themes(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<Vec<ThemeMeta>, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let themes = themes_root(&root);
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&themes) else {
        return Ok(out);
    };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if id.starts_with('.') {
            continue;
        }
        out.push(meta_from_dir(&entry.path(), &id));
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

const TEXT_EXTS: [&str; 8] = ["hbs", "css", "js", "json", "txt", "md", "html", "svg"];

#[tauri::command]
pub fn read_theme_files(window: tauri::WebviewWindow, state: State<'_, AppState>, theme_id: String) -> Result<HashMap<String, String>, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let dir = theme_dir(&root, &theme_id)?;
    if !dir.exists() {
        return Err(format!("主题不存在: {theme_id}"));
    }
    let mut out = HashMap::new();
    for entry in walkdir::WalkDir::new(&dir).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let ext = entry.path().extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        if !TEXT_EXTS.contains(&ext.as_str()) {
            continue; // 二进制(preview.png 等)不进入编辑器
        }
        let rel = rel_posix(&dir, entry.path());
        let text = std::fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
        out.insert(rel, text);
    }
    Ok(out)
}

#[tauri::command]
pub fn save_theme_files(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    theme_id: String,
    files: HashMap<String, String>,
) -> Result<(), String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let dir = theme_dir(&root, &theme_id)?;
    if !dir.exists() {
        return Err(format!("主题不存在: {theme_id}"));
    }
    for (rel, content) in &files {
        let full = safe_join(&dir, rel)?;
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&full, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn create_custom_theme(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    name: String,
    files: HashMap<String, String>,
) -> Result<ThemeMeta, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let themes = themes_root(&root);
    std::fs::create_dir_all(&themes).map_err(|e| e.to_string())?;

    let base_id = safe_name(&name).to_lowercase().replace(' ', "-");
    let dir = unique_path(&themes.join(&base_id));

    // 覆盖 theme.json 的 id 与 name
    let mut files = files;
    let mut meta_value: serde_json::Value = files
        .get("theme.json")
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::json!({}));
    let final_id = dir.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or(base_id);
    if let Some(obj) = meta_value.as_object_mut() {
        obj.insert("id".into(), serde_json::json!(final_id));
        obj.insert("name".into(), serde_json::json!(name));
    }
    files.insert(
        "theme.json".into(),
        serde_json::to_string_pretty(&meta_value).map_err(|e| e.to_string())?,
    );

    write_theme_files_to(&dir, &files)?;
    Ok(meta_from_dir(&dir, &final_id))
}

fn write_theme_files_to(dir: &PathBuf, files: &HashMap<String, String>) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    for (rel, content) in files {
        let full = safe_join(dir, rel)?;
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&full, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_theme(window: tauri::WebviewWindow, state: State<'_, AppState>, theme_id: String) -> Result<(), String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let dir = theme_dir(&root, &theme_id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 导入 ZIP 的限额:防止畸形压缩包(解压炸弹)耗尽内存
const IMPORT_MAX_ENTRIES: usize = 500;
const IMPORT_MAX_TOTAL_BYTES: usize = 20 * 1024 * 1024;

#[tauri::command]
pub fn import_theme_zip(window: tauri::WebviewWindow, state: State<'_, AppState>, zip_path: String) -> Result<ThemeMeta, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let themes = themes_root(&root);
    std::fs::create_dir_all(&themes).map_err(|e| e.to_string())?;

    let file = std::fs::File::open(&zip_path).map_err(|e| format!("打开压缩包失败: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("读取压缩包失败: {e}"))?;
    if archive.len() > IMPORT_MAX_ENTRIES {
        return Err("压缩包条目过多".into());
    }

    // 先解出全部条目(防 zip-slip),再定位 theme.json
    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    let mut total_bytes = 0usize;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().replace('\\', "/");
        let path = std::path::Path::new(&name);
        if path.is_absolute() || name.split('/').any(|seg| seg == "..") {
            return Err(format!("压缩包内含非法路径: {name}"));
        }
        // 单条目按 zip 头声明的解压后大小先预检再读取:畸形包(解压炸弹)在
        // read_to_end 把巨量字节读进内存之前即被拒绝
        if entry.size() > IMPORT_MAX_TOTAL_BYTES as u64 {
            return Err("压缩包含超大条目(单条上限 20MB)".into());
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        total_bytes += bytes.len();
        if total_bytes > IMPORT_MAX_TOTAL_BYTES {
            return Err("压缩包解压后过大(上限 20MB)".into());
        }
        entries.push((name, bytes));
    }

    let theme_json = entries
        .iter()
        .find(|(name, _)| name == "theme.json")
        .map(|(_, bytes)| bytes.clone())
        .ok_or("压缩包缺少 theme.json")?;
    let mut meta_value: serde_json::Value =
        serde_json::from_slice(&theme_json).map_err(|_| "theme.json 不是合法 JSON")?;

    if !entries.iter().any(|(name, _)| name == "templates/layout.hbs") {
        return Err("invalid-theme: 缺少 templates/layout.hbs".into());
    }

    let raw_id = meta_value["id"].as_str().unwrap_or_default();
    let raw_name = meta_value["name"].as_str().unwrap_or("theme").to_string();
    let base_id = if raw_id.is_empty() { raw_name } else { raw_id.to_string() };
    let dir = unique_path(&themes.join(safe_name(&base_id).to_lowercase().replace(' ', "-")));
    let final_id = dir.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();

    if let Some(obj) = meta_value.as_object_mut() {
        obj.insert("id".into(), serde_json::json!(final_id));
    }

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for (name, bytes) in &entries {
        let full = safe_join(&dir, name)?;
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&full, bytes).map_err(|e| e.to_string())?;
    }
    // 重写 theme.json(带最终 id)
    let pretty = serde_json::to_string_pretty(&meta_value).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("theme.json"), pretty).map_err(|e| e.to_string())?;

    Ok(meta_from_dir(&dir, &final_id))
}

#[tauri::command]
pub fn export_theme_zip(window: tauri::WebviewWindow, files: HashMap<String, String>, dest_path: String) -> Result<(), String> {
    ensure_main(&window)?;
    // 目标必须是 .zip 且父目录已存在,避免命令被滥用为向任意路径写文件
    let dest = PathBuf::from(&dest_path);
    let is_zip = dest
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("zip"))
        .unwrap_or(false);
    if !is_zip {
        return Err("导出目标必须是 .zip 文件".into());
    }
    if dest.parent().map(|p| !p.as_os_str().is_empty() && !p.is_dir()).unwrap_or(false) {
        return Err("导出目录不存在".into());
    }
    let file = std::fs::File::create(&dest_path).map_err(|e| format!("创建文件失败: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, content) in &files {
        let path = std::path::Path::new(name);
        if path.is_absolute() || name.split('/').any(|seg| seg == "..") {
            continue;
        }
        zip.start_file(name.as_str(), options)
            .map_err(|e| format!("写入 {name} 失败: {e}"))?;
        zip.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}
