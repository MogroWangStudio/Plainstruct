/** 统一 IPC 入口 -- Tauri 环境走 invoke,浏览器走 mock */
import type {
  AppSettings,
  Bootstrap,
  CopyItem,
  GithubConfig,
  OutputFile,
  PagesBuildStatus,
  PublishPreflight,
  SiteConfig,
  SyncProgress,
  SyncResult,
  ThemeMeta,
  TreeNode,
  UpdateDownloadResult,
  UpdateInfo,
  VerifyResult,
} from "./types";
import { Events, listen } from "./events";
import { mock, mockPickDirectory, mockPickImage, mockPickZip } from "./mock";
const inTauri = "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

function errText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

export { inTauri };

export const ipc = {
  inTauri,

  /* ---------- 应用 ---------- */
  getBootstrap(): Promise<Bootstrap> {
    return inTauri ? invoke<Bootstrap>("get_bootstrap") : mock.getBootstrap();
  },
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return inTauri ? invoke<AppSettings>("save_settings", { patch }) : mock.saveSettings(patch);
  },
  logFrontend(msg: string): Promise<void> {
    return inTauri ? invoke<void>("log_frontend", { msg }) : mock.logFrontend(msg);
  },
  /** 启动失败上报:返回本轮自愈动作(reload=重载 clear-data=已清浏览数据请重载 give-up=放弃) */
  reportBootFailure(stage: string, detail: string): Promise<"reload" | "clear-data" | "give-up"> {
    return inTauri
      ? invoke<"reload" | "clear-data" | "give-up">("report_boot_failure", { stage, detail })
      : Promise.resolve("give-up");
  },
  /** 启动成功:连续失败计数清零(非 Tauri 环境空操作) */
  reportBootSuccess(): Promise<void> {
    return inTauri ? invoke<void>("report_boot_success") : Promise.resolve();
  },
  /** 手动急救:清除 WebView 浏览数据(缓存/存储损坏导致的白屏修复) */
  repairWebviewData(): Promise<void> {
    return inTauri ? invoke<void>("repair_webview_data") : Promise.resolve();
  },
  checkUpdate(): Promise<UpdateInfo> {
    return inTauri ? invoke<UpdateInfo>("check_update") : mock.checkUpdate();
  },
  /** 下载官方最新 Release 的当前平台更新包;可再次调用以续传,paused=true 表示已暂停返回 */
  updateDownload(): Promise<UpdateDownloadResult> {
    return inTauri ? invoke<UpdateDownloadResult>("update_download") : mock.updateDownload();
  },
  /** 暂停下载(保留断点) */
  updatePause(): Promise<void> {
    return inTauri ? invoke<void>("update_pause") : mock.updatePause();
  },
  /** 取消下载或放弃已就绪的更新(清理任务文件与更新包) */
  updateCancel(): Promise<void> {
    return inTauri ? invoke<void>("update_cancel") : mock.updateCancel();
  },
  /** 重启并更新:拉起更新向导后关闭应用,由向导完成安装并启动新版本 */
  updateRestartInstall(): Promise<void> {
    return inTauri ? invoke<void>("update_restart_and_install") : mock.updateRestartInstall();
  },
  /** 更改数据存储位置(null = 恢复默认),数据迁移后立即生效 */
  setDataDir(path: string | null): Promise<void> {
    return inTauri ? invoke<void>("set_data_dir", { path }) : mock.setDataDir(path);
  },
  openDataDir(): Promise<void> {
    return inTauri ? invoke<void>("open_data_dir") : mock.openDataDir();
  },

  /* ---------- 站点 ---------- */
  createSite(dir: string, name: string, description?: string, siteType?: string): Promise<SiteConfig> {
    return inTauri
      ? invoke<SiteConfig>("create_site", { dir, name, description, siteType })
      : mock.createSite(dir, name, description, siteType);
  },
  openSite(dir: string): Promise<SiteConfig> {
    return inTauri ? invoke<SiteConfig>("open_site", { dir }) : mock.openSite(dir);
  },
  closeSite(): Promise<void> {
    return inTauri ? invoke<void>("close_site") : mock.closeSite();
  },
  getSiteRoot(): Promise<string> {
    return inTauri ? invoke<string>("get_site_root") : Promise.resolve("");
  },
  readSiteConfig(): Promise<SiteConfig> {
    return inTauri ? invoke<SiteConfig>("read_site_config") : mock.readSiteConfig();
  },
  saveSiteConfig(patch: Partial<SiteConfig>): Promise<SiteConfig> {
    return inTauri
      ? invoke<SiteConfig>("save_site_config", { patch })
      : mock.saveSiteConfig(patch);
  },
  setSiteLogo(srcPath: string): Promise<string> {
    return inTauri ? invoke<string>("set_site_logo", { srcPath }) : mock.setSiteLogo(srcPath);
  },
  removeSiteLogo(): Promise<SiteConfig> {
    return inTauri ? invoke<SiteConfig>("remove_site_logo") : mock.removeSiteLogo();
  },

  /* ---------- 内容 ---------- */
  listTree(): Promise<TreeNode[]> {
    return inTauri ? invoke<TreeNode[]>("list_tree") : mock.listTree();
  },
  /** 保存某目录下的手动排序(传入该目录全部子项的期望顺序) */
  saveDocOrder(dir: string, names: string[]): Promise<void> {
    return inTauri ? invoke<void>("save_doc_order", { dir, names }) : mock.saveDocOrder(dir, names);
  },
  readDocs(paths: string[]): Promise<string[]> {
    return inTauri ? invoke<string[]>("read_docs", { paths }) : mock.readDocs(paths);
  },
  saveDoc(path: string, content: string): Promise<void> {
    return inTauri ? invoke<void>("save_doc", { path, content }) : mock.saveDoc(path, content);
  },
  createDoc(dir: string, name: string, title?: string, description?: string): Promise<string> {
    return inTauri
      ? invoke<string>("create_doc", {
          dir,
          name,
          title: title ?? null,
          description: description ?? null,
        })
      : mock.createDoc(dir, name, title, description);
  },
  createFolder(parent: string, name: string): Promise<string> {
    return inTauri
      ? invoke<string>("create_folder", { parent, name })
      : mock.createFolder(parent, name);
  },
  renameItem(path: string, newName: string): Promise<string> {
    return inTauri
      ? invoke<string>("rename_item", { path, newName })
      : mock.renameItem(path, newName);
  },
  moveItem(src: string, destDir: string): Promise<string> {
    return inTauri ? invoke<string>("move_item", { src, destDir }) : mock.moveItem(src, destDir);
  },
  deleteItem(path: string): Promise<void> {
    return inTauri ? invoke<void>("delete_item", { path }) : mock.deleteItem(path);
  },
  importFiles(srcPaths: string[], destDir: string): Promise<number> {
    return inTauri
      ? invoke<number>("import_files", { srcPaths, destDir })
      : mock.importFiles(srcPaths, destDir);
  },
  /** 站点图片统一导入:复制进 content/images/(自动建目录、重名加序号),返回实际落盘文件名 */
  importSiteImages(srcPaths: string[]): Promise<string[]> {
    return inTauri
      ? invoke<string[]>("import_site_images", { srcPaths })
      : mock.importSiteImages(srcPaths);
  },

  /* ---------- 构建 ---------- */
  clearBuild(): Promise<void> {
    return inTauri ? invoke<void>("clear_build") : mock.clearBuild();
  },
  writeBuildFiles(files: OutputFile[]): Promise<void> {
    return inTauri
      ? invoke<void>("write_build_files", { files })
      : mock.writeBuildFiles(files);
  },
  copyPaths(items: CopyItem[]): Promise<number> {
    return inTauri ? invoke<number>("copy_paths", { items }) : mock.copyPaths(items);
  },

  /* ---------- 主题 ---------- */
  listCustomThemes(): Promise<ThemeMeta[]> {
    return inTauri ? invoke<ThemeMeta[]>("list_custom_themes") : mock.listCustomThemes();
  },
  readThemeFiles(themeId: string): Promise<Record<string, string>> {
    return inTauri
      ? invoke<Record<string, string>>("read_theme_files", { themeId })
      : mock.readThemeFiles(themeId);
  },
  saveThemeFiles(themeId: string, files: Record<string, string>): Promise<void> {
    return inTauri
      ? invoke<void>("save_theme_files", { themeId, files })
      : mock.saveThemeFiles(themeId, files);
  },
  createCustomTheme(name: string, files: Record<string, string>): Promise<ThemeMeta> {
    return inTauri
      ? invoke<ThemeMeta>("create_custom_theme", { name, files })
      : mock.createCustomTheme(name, files);
  },
  deleteTheme(themeId: string): Promise<void> {
    return inTauri ? invoke<void>("delete_theme", { themeId }) : mock.deleteTheme(themeId);
  },
  importThemeZip(zipPath: string): Promise<ThemeMeta> {
    return inTauri
      ? invoke<ThemeMeta>("import_theme_zip", { zipPath })
      : mock.importThemeZip(zipPath);
  },
  exportThemeZip(files: Record<string, string>, destPath: string): Promise<void> {
    return inTauri
      ? invoke<void>("export_theme_zip", { files, destPath })
      : mock.exportThemeZip(files, destPath);
  },

  /* ---------- GitHub ---------- */
  githubReadConfig(): Promise<GithubConfig> {
    return inTauri ? invoke<GithubConfig>("github_read_config") : mock.githubReadConfig();
  },
  githubSaveConfig(cfg: GithubConfig): Promise<void> {
    return inTauri
      ? invoke<void>("github_save_config", { cfg })
      : mock.githubSaveConfig(cfg);
  },
  githubVerify(cfg: GithubConfig): Promise<VerifyResult> {
    return inTauri ? invoke<VerifyResult>("github_verify", { cfg }) : mock.githubVerify(cfg);
  },
  /** 发布前预检:本地构建是否过期、云端是否被外部更新(仅提醒) */
  githubPreflight(cfg: GithubConfig): Promise<PublishPreflight> {
    return inTauri ? invoke<PublishPreflight>("github_preflight", { cfg }) : mock.githubPreflight(cfg);
  },
  /** 查询 Pages 最新构建是否已覆盖本次发布的提交 */
  githubPagesStatus(cfg: GithubConfig, commit: string): Promise<PagesBuildStatus> {
    return inTauri ? invoke<PagesBuildStatus>("github_pages_status", { cfg, commit }) : mock.githubPagesStatus(cfg, commit);
  },
  async githubSync(cfg: GithubConfig, onProgress: (p: SyncProgress) => void): Promise<SyncResult> {
    if (!inTauri) return mock.githubSync(cfg, onProgress);
    const stop = await listen<SyncProgress>(Events.SyncProgress, (p) => onProgress(p));
    try {
      return await invoke<SyncResult>("github_sync", { cfg });
    } finally {
      stop();
    }
  },

  /* ---------- 系统 ---------- */
  openPath(path: string): Promise<void> {
    return inTauri ? invoke<void>("open_path", { path }) : mock.openPath(path);
  },
  openExternal(url: string): Promise<void> {
    return inTauri ? invoke<void>("open_external", { url }) : mock.openExternal(url);
  },

  /* ---------- 剪贴板 ---------- */
  async readClipboardText(): Promise<string> {
    if (!inTauri) {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return "";
      }
    }
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return await readText();
    } catch {
      return "";
    }
  },
  async writeClipboardText(text: string): Promise<void> {
    if (!inTauri) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* 浏览器环境权限受限时忽略 */
      }
      return;
    }
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
  },

  /* ---------- 文件选择 ---------- */
  async pickDirectory(): Promise<string | null> {
    if (!inTauri) return mockPickDirectory();
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, multiple: false });
    return typeof dir === "string" ? dir : null;
  },
  async pickLogo(): Promise<string | null> {
    if (!inTauri) return mockPickImage();
    const { open } = await import("@tauri-apps/plugin-dialog");
    const file = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "svg", "jpg", "jpeg", "webp", "ico"] }],
    });
    return typeof file === "string" ? file : null;
  },
  /** 编辑器插入图片:多选图片文件(mock 环境返回示例路径走通流程) */
  async pickImages(): Promise<string[] | null> {
    if (!inTauri) return ["C:/Users/me/Pictures/photo-1.png", "C:/Users/me/Pictures/photo-2.png"];
    const { open } = await import("@tauri-apps/plugin-dialog");
    const files = await open({
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"] }],
    });
    return Array.isArray(files) ? files : files ? [files] : null;
  },
  async pickImportFiles(): Promise<string[] | null> {
    if (!inTauri) return ["C:/Docs/imported-note.md"];
    const { open } = await import("@tauri-apps/plugin-dialog");
    const files = await open({
      multiple: true,
      filters: [
        {
          name: "Markdown & Images",
          extensions: ["md", "markdown", "png", "jpg", "jpeg", "gif", "webp", "svg"],
        },
      ],
    });
    return Array.isArray(files) ? files : files ? [files] : null;
  },
  async pickThemeZip(): Promise<string | null> {
    if (!inTauri) return mockPickZip();
    const { open } = await import("@tauri-apps/plugin-dialog");
    const file = await open({
      multiple: false,
      filters: [{ name: "Plainstruct Theme", extensions: ["zip"] }],
    });
    return typeof file === "string" ? file : null;
  },
  async pickZipDest(defaultName: string): Promise<string | null> {
    if (!inTauri) return `C:/Downloads/${defaultName}`;
    const { save } = await import("@tauri-apps/plugin-dialog");
    const file = await save({
      defaultPath: defaultName,
      filters: [{ name: "Plainstruct Theme", extensions: ["zip"] }],
    });
    return typeof file === "string" ? file : null;
  },

  errText,
};
