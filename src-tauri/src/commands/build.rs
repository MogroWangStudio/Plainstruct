/** 构建命令:清理/写出文本文件/拷贝资源 */
use serde::Deserialize;
use std::path::PathBuf;
use tauri::State;

use crate::fsutil::{rel_posix, safe_join};
use crate::state::{ensure_main, AppState};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputFile {
    pub path: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct CopyItem {
    pub src: String,
    pub dest: String,
}

fn build_root(root: &PathBuf) -> PathBuf {
    root.join("build")
}

#[tauri::command]
pub fn clear_build(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let build = build_root(&root);
    if build.exists() {
        std::fs::remove_dir_all(&build).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&build).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_build_files(window: tauri::WebviewWindow, state: State<'_, AppState>, files: Vec<OutputFile>) -> Result<(), String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    let build = build_root(&root);
    std::fs::create_dir_all(&build).map_err(|e| e.to_string())?;
    for file in &files {
        let full = safe_join(&build, &file.path)?;
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&full, &file.content).map_err(|e| format!("写出 {} 失败: {e}", file.path))?;
    }
    Ok(())
}

fn copy_recursive(src: &PathBuf, dest: &PathBuf) -> Result<(), String> {
    if src.is_file() {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(src, dest).map_err(|e| e.to_string())?;
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(src).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry.path().strip_prefix(src).map_err(|e| e.to_string())?;
        let target = dest.join(rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn copy_paths(window: tauri::WebviewWindow, state: State<'_, AppState>, items: Vec<CopyItem>) -> Result<(), String> {
    ensure_main(&window)?;
    let root = state.site_root()?;
    // dest 相对 build/ 落盘:构建出的页面以 build/ 为根引用资源(图片、站点 logo 等)
    let build = build_root(&root);
    for item in &items {
        let src = safe_join(&root, &item.src)?;
        let dest = safe_join(&build, &item.dest)?;
        if !src.exists() {
            continue; // 资源缺失不阻断构建
        }
        if src.is_dir() {
            std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            copy_recursive(&src, &dest)?;
        } else {
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 供 GitHub 同步收集构建产物
pub fn collect_build_files(root: &PathBuf) -> Result<Vec<(String, Vec<u8>)>, String> {
    let build = build_root(root);
    if !build.exists() {
        return Err("build 目录不存在,请先构建".into());
    }
    let mut out = Vec::new();
    // GitHub 的 tree API 拒绝重复 path:同名条目(软链/连接点意外等)提前检出并给出明确提示
    let mut seen = std::collections::HashSet::new();
    for entry in walkdir::WalkDir::new(&build).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = rel_posix(&build, entry.path());
        if !seen.insert(rel.clone()) {
            return Err(format!("构建产物中存在重复路径 {rel},请清理 build 目录后重新构建"));
        }
        let bytes = std::fs::read(entry.path()).map_err(|e| e.to_string())?;
        out.push((rel, bytes));
    }
    Ok(out)
}
