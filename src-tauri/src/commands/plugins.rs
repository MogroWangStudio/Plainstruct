/** 站点插件命令:用户导入插件的文件管理(.plainstruct/plugins/<id>/) */
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

use crate::fsutil::{safe_join, safe_name};
use crate::state::{ensure_main, AppState};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SitePluginEntry {
    pub id: String,
    pub name: String,
    pub files: Vec<String>,
    pub enabled: bool,
    /// 插件描述(可编辑;导入识别或复制内置时预填)
    #[serde(default)]
    pub description: Option<String>,
    /// 开发者(导入识别或复制内置时预填)
    #[serde(default)]
    pub developer: Option<String>,
    /// 插件版本(导入识别或复制内置时预填)
    #[serde(default)]
    pub version: Option<String>,
    /// 复制自哪个内置插件(search/imgPreview):界面据此标注来源
    #[serde(default)]
    pub builtin_copy_of: Option<String>,
}

/// 导入结果:条目 + 是否识别为 Plainstruct 插件(recognized 不落盘)
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPlugin {
    #[serde(flatten)]
    pub entry: SitePluginEntry,
    pub recognized: bool,
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

/// Plainstruct 插件识别:文件头部(前 4KB)含「Plainstruct Plugin」标记注释,
/// 随后第一个平衡的 JSON 对象为元数据 { name, version, developer, description }。
/// 识别成功则预填条目元数据;未识别仍可导入(按普通脚本对待)。
fn recognize_plugin_header(content: &str) -> Option<(String, Option<String>, Option<String>, Option<String>)> {
    let head: String = content.chars().take(4096).collect();
    let marker = head.find("Plainstruct Plugin")?;
    let open = head[marker..].find('{')? + marker;
    let bytes = head.as_bytes();
    let mut depth = 0usize;
    let mut end = None;
    let mut in_str = false;
    let mut esc = false;
    for (i, &b) in bytes.iter().enumerate().skip(open) {
        if in_str {
            if esc {
                esc = false;
            } else if b == b'\\' {
                esc = true;
            } else if b == b'"' {
                in_str = false;
            }
            continue;
        }
        match b {
            b'"' => in_str = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(i + 1);
                    break;
                }
            }
            _ => {}
        }
    }
    let json = &head[open..end?];
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let name = v.get("name").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())?;
    let version = v.get("version").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let developer = v.get("developer").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let description = v.get("description").and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    Some((name, version, developer, description))
}

#[tauri::command]
pub fn import_site_plugin(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    src_paths: Vec<String>,
) -> Result<ImportedPlugin, String> {
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

    // 插件识别:读取首个 .js 文件头部,匹配 Plainstruct 插件标记与元数据 JSON
    let mut recognized_meta: Option<(String, Option<String>, Option<String>, Option<String>)> = None;
    for src in &sources {
        if plugin_ext(src).as_deref() != Some("js") {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(src) {
            if let Some(meta) = recognize_plugin_header(&text) {
                recognized_meta = Some(meta);
                break;
            }
        }
    }
    let recognized = recognized_meta.is_some();

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
            // 识别命中时用插件头声明的名称,否则回退文件名
            name = recognized_meta
                .as_ref()
                .map(|(n, _, _, _)| safe_name(n))
                .filter(|n| !n.is_empty())
                .or_else(|| {
                    src.file_stem()
                        .map(|s| safe_name(&s.to_string_lossy()))
                        .filter(|n| !n.is_empty())
                })
                .unwrap_or_else(|| stored.clone());
        }
        files.push(stored);
    }

    let (r_name, r_version, r_developer, r_description) = recognized_meta
        .clone()
        .unwrap_or_default();
    let _ = r_name; // 名称已在上方的拷贝循环中消费
    Ok(ImportedPlugin {
        entry: SitePluginEntry {
            id,
            name,
            files,
            enabled: true,
            description: r_description,
            developer: r_developer,
            version: r_version,
            builtin_copy_of: None,
        },
        recognized,
    })
}

/// 新建自定义插件(复制内置插件/前端生成的脚手架):写入文件集并返回条目。
/// 文件名仅放行安全名与 .js/.css 扩展,内容为文本。
#[tauri::command]
pub fn create_site_plugin_files(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
    developer: Option<String>,
    version: Option<String>,
    builtin_copy_of: Option<String>,
    files: Vec<SitePluginFile>,
) -> Result<SitePluginEntry, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    if files.is_empty() {
        return Err("插件文件为空".into());
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let id = format!("plugin-{}-{}", nanos % 1_000_000, std::process::id() % 9973);
    let dir = plugin_dir(&root, &id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut stored_names: Vec<String> = Vec::new();
    for file in &files {
        let base = safe_name(&file.name);
        if base.is_empty() || plugin_ext(std::path::Path::new(&base)).is_none() {
            return Err(format!("仅支持 .js 与 .css 文件: {}", file.name));
        }
        let dest = dir.join(&base);
        std::fs::write(&dest, &file.content).map_err(|e| format!("写入失败: {e}"))?;
        stored_names.push(base);
    }

    Ok(SitePluginEntry {
        id,
        name: safe_name(&name),
        files: stored_names,
        enabled: true,
        description,
        developer,
        version,
        builtin_copy_of,
    })
}

/// 保存自定义插件的单个文件(二次开发):只允许覆盖插件目录内已存在的 .js/.css 文件
#[tauri::command]
pub fn write_site_plugin_file(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    id: String,
    name: String,
    content: String,
) -> Result<(), String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let base = safe_name(&name);
    if base.is_empty() || base != name || plugin_ext(std::path::Path::new(&base)).is_none() {
        return Err(format!("非法的插件文件名: {name}"));
    }
    let dir = plugin_dir(&root, &id)?;
    let full = safe_join(&dir, &base)?;
    if !full.exists() {
        return Err(format!("插件文件不存在: {base}"));
    }
    std::fs::write(&full, content).map_err(|e| format!("写入失败: {e}"))
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
