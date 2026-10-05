/** 内容命令:文件树、文档读写、增删改移、导入、手动排序 */
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::State;

use crate::commands::site::plainstruct_dir;
use crate::fsutil::{is_importable, rel_posix, safe_join, safe_name, unique_path};
use crate::state::{ensure_main, AppState};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: String,
    /// 文件字节数(仅文件节点;目录为 None 不序列化)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<TreeNode>,
}

fn content_root(root: &PathBuf) -> PathBuf {
    root.join("content")
}

/// 自然排序:数字段按数值比较,其余按小写字母比较。
/// 未被手动排列过的项使用该顺序,与文件系统返回顺序无关。
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let av: Vec<char> = a.to_lowercase().chars().collect();
    let bv: Vec<char> = b.to_lowercase().chars().collect();
    let (mut i, mut j) = (0usize, 0usize);
    while i < av.len() && j < bv.len() {
        if av[i].is_ascii_digit() && bv[j].is_ascii_digit() {
            let mut i2 = i;
            while i2 < av.len() && av[i2].is_ascii_digit() {
                i2 += 1;
            }
            let mut j2 = j;
            while j2 < bv.len() && bv[j2].is_ascii_digit() {
                j2 += 1;
            }
            let an: u64 = av[i..i2].iter().collect::<String>().parse().unwrap_or(u64::MAX);
            let bn: u64 = bv[j..j2].iter().collect::<String>().parse().unwrap_or(u64::MAX);
            if an != bn {
                return an.cmp(&bn);
            }
            i = i2;
            j = j2;
        } else {
            if av[i] != bv[j] {
                return av[i].cmp(&bv[j]);
            }
            i += 1;
            j += 1;
        }
    }
    (av.len() - i).cmp(&(bv.len() - j))
}

/* ---------- 手动排序(order.json) ---------- */

/// 自定义文档顺序:目录相对路径(空串为 content 根)-> 该目录下子项名称的有序列表。
/// 已记录的项按列表顺序排列;未记录的项按默认规则追加在后,因此新建/导入不打乱既有排列。
type DocOrderMap = BTreeMap<String, Vec<String>>;

fn order_path(root: &PathBuf) -> PathBuf {
    plainstruct_dir(root).join("order.json")
}

fn read_order_map(root: &PathBuf) -> DocOrderMap {
    std::fs::read_to_string(order_path(root))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_order_map(root: &PathBuf, map: &DocOrderMap) -> Result<(), String> {
    std::fs::create_dir_all(plainstruct_dir(root)).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    std::fs::write(order_path(root), json).map_err(|e| e.to_string())
}

/// 就地修改 order.json;无实际变化时不写盘
fn mutate_order(root: &PathBuf, f: impl FnOnce(&mut DocOrderMap)) -> Result<(), String> {
    let mut map = read_order_map(root);
    let before = map.clone();
    f(&mut map);
    if map != before {
        write_order_map(root, &map)?;
    }
    Ok(())
}

fn rel_basename(p: &str) -> &str {
    p.rsplit('/').next().unwrap_or(p)
}

fn rel_dirname(p: &str) -> &str {
    match p.rfind('/') {
        Some(i) => &p[..i],
        None => "",
    }
}

/// 同级排序:手动顺序在前,未记录项按「目录优先 + 名称自然排序」追加在后
fn sort_nodes(nodes: &mut Vec<TreeNode>, manual: Option<&Vec<String>>) {
    match manual {
        Some(names) => nodes.sort_by(|a, b| {
            let pa = names.iter().position(|s| s == &a.name);
            let pb = names.iter().position(|s| s == &b.name);
            match (pa, pb) {
                (Some(x), Some(y)) => x.cmp(&y),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => a.node_type.cmp(&b.node_type).then_with(|| natural_cmp(&a.name, &b.name)),
            }
        }),
        None => nodes.sort_by(|a, b| {
            a.node_type.cmp(&b.node_type).then_with(|| natural_cmp(&a.name, &b.name))
        }),
    }
}

/// 递归构建内容树:同级按手动顺序(order.json),未记录项按默认规则
fn walk(dir: &PathBuf, rel: &str, order: &DocOrderMap) -> Vec<TreeNode> {
    let mut dirs: Vec<(String, PathBuf)> = Vec::new();
    let mut files: Vec<(String, PathBuf)> = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            dirs.push((name, entry.path()));
        } else if ft.is_file() {
            files.push((name, entry.path()));
        }
    }

    let mut nodes = Vec::new();
    for (name, path) in dirs {
        let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        let children = walk(&path, &child_rel, order);
        nodes.push(TreeNode {
            name,
            path: child_rel,
            node_type: "dir".into(),
            size: None,
            children,
        });
    }
    for (name, abs) in files {
        let path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        let size = std::fs::metadata(&abs).ok().map(|m| m.len());
        nodes.push(TreeNode {
            name,
            path,
            node_type: "file".into(),
            size,
            children: Vec::new(),
        });
    }
    sort_nodes(&mut nodes, order.get(rel));
    nodes
}

#[tauri::command]
pub fn list_tree(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<Vec<TreeNode>, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let order = read_order_map(&root);
    Ok(walk(&content_root(&root), "", &order))
}

/// 保存某个目录下的手动排序(传入该目录全部子项的期望顺序)
#[tauri::command]
pub fn save_doc_order(window: tauri::WebviewWindow, state: State<'_, AppState>, dir: String, names: Vec<String>) -> Result<(), String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    if !dir.is_empty() {
        let full = safe_join(&content_root(&root), &dir)?;
        if !full.is_dir() {
            return Err(format!("目录不存在: {dir}"));
        }
    }
    let mut map = read_order_map(&root);
    map.insert(dir, names);
    write_order_map(&root, &map)
}

#[tauri::command]
pub fn read_docs(window: tauri::WebviewWindow, state: State<'_, AppState>, paths: Vec<String>) -> Result<Vec<String>, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let content = content_root(&root);
    let mut out = Vec::with_capacity(paths.len());
    for p in &paths {
        let full = safe_join(&content, p)?;
        let bytes = std::fs::read(&full).map_err(|e| format!("读取 {p} 失败: {e}"))?;
        out.push(String::from_utf8_lossy(&bytes).to_string());
    }
    Ok(out)
}

#[tauri::command]
pub fn save_doc(window: tauri::WebviewWindow, state: State<'_, AppState>, path: String, content: String) -> Result<(), String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let full = safe_join(&content_root(&root), &path)?;
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&full, content).map_err(|e| format!("保存 {path} 失败: {e}"))
}

#[tauri::command]
pub fn create_doc(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    dir: String,
    name: String,
    title: Option<String>,
    description: Option<String>,
) -> Result<String, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let content = content_root(&root);
    let parent = if dir.is_empty() { content.clone() } else { safe_join(&content, &dir)? };
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;

    let clean = safe_name(&name);
    let file_name = if clean.to_lowercase().ends_with(".md") { clean } else { format!("{clean}.md") };
    let mut target = unique_path(&parent.join(&file_name));
    // unique_path 可能返回已带序号的文件名,这里确保文件名以 .md 结尾
    if !target.to_string_lossy().to_lowercase().ends_with(".md") {
        target.set_extension("md");
    }

    let doc_title = title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| target.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default());
    let desc_line = description
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
        .map(|d| format!("description: {d}\n"))
        .unwrap_or_default();
    let template = format!("---\ntitle: {doc_title}\n{desc_line}---\n\n正文。\n");
    std::fs::write(&target, template).map_err(|e| e.to_string())?;
    Ok(rel_posix(&content, &target))
}

#[tauri::command]
pub fn create_folder(window: tauri::WebviewWindow, state: State<'_, AppState>, parent: String, name: String) -> Result<String, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let content = content_root(&root);
    let parent_dir = if parent.is_empty() { content.clone() } else { safe_join(&content, &parent)? };
    let target = unique_path(&parent_dir.join(safe_name(&name)));
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    Ok(rel_posix(&content, &target))
}

#[tauri::command]
pub fn rename_item(window: tauri::WebviewWindow, state: State<'_, AppState>, path: String, new_name: String) -> Result<String, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let content = content_root(&root);
    let full = safe_join(&content, &path)?;
    if !full.exists() {
        return Err(format!("不存在: {path}"));
    }
    let parent = full.parent().ok_or("非法路径")?.to_path_buf();
    let target = unique_path(&parent.join(safe_name(&new_name)));
    let is_dir = full.is_dir();
    std::fs::rename(&full, &target).map_err(|e| e.to_string())?;
    let new_path = rel_posix(&content, &target);

    // 同步手动排序:父目录条目改名;目录改名时其子树的 order 键一并更新
    mutate_order(&root, |map| {
        let parent_key = rel_dirname(&path).to_string();
        let old_name = rel_basename(&path).to_string();
        if let Some(list) = map.get_mut(&parent_key) {
            for n in list.iter_mut() {
                if *n == old_name {
                    *n = rel_basename(&new_path).to_string();
                }
            }
        }
        if is_dir {
            let prefix = format!("{path}/");
            let keys: Vec<String> = map
                .keys()
                .filter(|k| k.starts_with(prefix.as_str()))
                .cloned()
                .collect();
            for k in keys {
                let nk = format!("{new_path}/{}", &k[prefix.len()..]);
                if let Some(v) = map.remove(&k) {
                    map.insert(nk, v);
                }
            }
        }
    })?;
    Ok(new_path)
}

#[tauri::command]
pub fn move_item(window: tauri::WebviewWindow, state: State<'_, AppState>, src: String, dest_dir: String) -> Result<String, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let content = content_root(&root);
    let src_full = safe_join(&content, &src)?;
    if !src_full.exists() {
        return Err(format!("不存在: {src}"));
    }
    let dest_parent = if dest_dir.is_empty() { content.clone() } else { safe_join(&content, &dest_dir)? };

    // 禁止把目录移动进自身或自身子树(strip_prefix 按路径组件比较,
    // 避免字符串前缀判断把「a 移入同级目录 ab」误判为移入自身)
    if dest_parent.strip_prefix(&src_full).is_ok() {
        return Err("invalid-move".into());
    }

    // 源已位于目标目录时为无操作:否则 unique_path 会因源文件自身占用目标名而生成 "-2" 副本名
    if src_full.parent() == Some(dest_parent.as_path()) {
        return Ok(src);
    }

    std::fs::create_dir_all(&dest_parent).map_err(|e| e.to_string())?;
    let name = src_full.file_name().ok_or("非法路径")?.to_os_string();
    let target = unique_path(&dest_parent.join(name));
    let is_dir = src_full.is_dir();
    std::fs::rename(&src_full, &target).map_err(|e| e.to_string())?;

    // 同步手动排序:从源目录的顺序中移除;目录移动时清理其子树的 order 键。
    // 目标目录不写入,移动项作为「未记录项」排在已有排列之后(或由前端随后写入精确位置)。
    mutate_order(&root, |map| {
        let src_parent = rel_dirname(&src).to_string();
        let src_name = rel_basename(&src).to_string();
        if let Some(list) = map.get_mut(&src_parent) {
            list.retain(|n| *n != src_name);
        }
        if is_dir {
            let prefix = format!("{src}/");
            map.retain(|k, _| !k.starts_with(prefix.as_str()));
        }
    })?;
    Ok(rel_posix(&content, &target))
}

#[tauri::command]
pub fn delete_item(window: tauri::WebviewWindow, state: State<'_, AppState>, path: String) -> Result<(), String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let full = safe_join(&content_root(&root), &path)?;
    if !full.exists() {
        return Ok(());
    }
    let is_dir = full.is_dir();
    trash::delete(&full).map_err(|e| format!("移入回收站失败: {e}"))?;

    // 同步手动排序:从父目录的顺序中移除;目录删除时清理其子树的 order 键
    mutate_order(&root, |map| {
        let parent_key = rel_dirname(&path).to_string();
        let name = rel_basename(&path).to_string();
        if let Some(list) = map.get_mut(&parent_key) {
            list.retain(|n| *n != name);
        }
        if is_dir {
            let prefix = format!("{path}/");
            map.retain(|k, _| !k.starts_with(prefix.as_str()));
        }
    })?;
    Ok(())
}

#[tauri::command]
pub fn import_files(window: tauri::WebviewWindow, state: State<'_, AppState>, src_paths: Vec<String>, dest_dir: String) -> Result<u32, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let content = content_root(&root);
    let dest_parent = if dest_dir.is_empty() { content.clone() } else { safe_join(&content, &dest_dir)? };
    std::fs::create_dir_all(&dest_parent).map_err(|e| e.to_string())?;

    let mut count = 0;
    for src in &src_paths {
        let src_path = PathBuf::from(src);
        if !src_path.is_file() || !is_importable(&src_path) {
            continue;
        }
        let name = src_path.file_name().ok_or("非法路径")?.to_os_string();
        let target = unique_path(&dest_parent.join(name));
        std::fs::copy(&src_path, &target).map_err(|e| e.to_string())?;
        count += 1;
    }
    Ok(count)
}

/// 导入站点图片:统一复制到 content/asset/(自动创建,重名自动加序号),
/// 返回落盘后的实际文件名(与传入顺序对应、跳过不可导入项),
/// 供编辑器按当前文档位置插入正确的相对引用路径。
#[tauri::command]
pub fn import_site_images(window: tauri::WebviewWindow, state: State<'_, AppState>, src_paths: Vec<String>) -> Result<Vec<String>, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let dest_parent = safe_join(&content_root(&root), "asset")?;
    std::fs::create_dir_all(&dest_parent).map_err(|e| e.to_string())?;

    let mut names = Vec::new();
    for src in &src_paths {
        let src_path = PathBuf::from(src);
        if !src_path.is_file() || !is_importable(&src_path) {
            continue;
        }
        let name = src_path.file_name().ok_or("非法路径")?.to_os_string();
        let target = unique_path(&dest_parent.join(name));
        std::fs::copy(&src_path, &target).map_err(|e| e.to_string())?;
        names.push(target.file_name().unwrap_or_default().to_string_lossy().to_string());
    }
    Ok(names)
}

/// 导入单张图片到指定的站点内路径(content/ 相对,如 asset/pic.png 或 img/pic.png):
/// 目标重名时自动加序号,返回实际落盘的 content/ 相对路径 ——
/// 供「插入图片」弹窗按用户选择的目标路径落盘(目标可含子目录)。
#[tauri::command]
pub fn import_site_image_to(window: tauri::WebviewWindow, state: State<'_, AppState>, src: String, dest: String) -> Result<String, String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let src_path = PathBuf::from(&src);
    if !src_path.is_file() || !is_importable(&src_path) {
        return Err("源文件不是可导入的图片".into());
    }
    let dest = dest.trim().trim_start_matches('/');
    if dest.is_empty() {
        return Err("目标路径为空".into());
    }
    // 目标限制在 content/ 内:safe_join 拒绝越界(../ 与绝对路径)
    let target_base = safe_join(&content_root(&root), dest)?;
    if let Some(parent) = target_base.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let target = unique_path(&target_base);
    std::fs::copy(&src_path, &target).map_err(|e| e.to_string())?;
    target
        .strip_prefix(content_root(&root))
        .map_err(|_| "路径计算失败".into())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}
