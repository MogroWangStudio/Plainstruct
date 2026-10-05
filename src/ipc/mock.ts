/** 浏览器 mock -- 无 Tauri 环境时的内存虚拟文件系统,用于纯前端开发 */
import type {
  AppSettings,
  Bootstrap,
  CopyItem,
  FolderMeta,
  GithubConfig,
  OutputFile,
  PagesBuildStatus,
  PublishPreflight,
  RecentSite,
  SiteConfig,
  SitePluginEntry,
  SitePluginFiles,
  SyncProgress,
  SyncResult,
  ThemeMeta,
  TreeNode,
  UpdateDownloadResult,
  UpdateInfo,
  VerifyResult,
} from "./types";
import { Events, mockEmit } from "./events";
import { getBuiltinTheme } from "@/themes/manifest";

const LS_SETTINGS = "plainstruct.settings";
const LS_RECENT = "plainstruct.recent";

export const DEMO_ROOT = "C:/Sites/Plainstruct 演示站点";

/** 绝对路径 -> 文件内容 */
const files = new Map<string, string>();
/** 绝对路径 -> 最后写入时间(毫秒):mock 的 mtime,随写入/移动更新 */
const filesMtime = new Map<string, number>();

function touchFile(abs: string) {
  filesMtime.set(abs, Date.now());
}
/** 自定义主题 id -> 文件表 */
const customThemes = new Map<string, Record<string, string>>();
let settings: AppSettings = { locale: "zh-CN", autosave: true, autosaveDelay: 900, disableRefreshAnim: false, theme: "system", uiFont: "system", uiFontSize: 1, uiFontWeight: 400, editorFont: "default", editorWhitespace: true, editorBreakKey: "enter", editorIndentKey: "tab", editorIndentWidth: 2 };
let recent: RecentSite[] = [];
let currentRoot: string | null = null;
let siteCounter = 0;
let buildFiles = new Map<string, string>();
/** 站点插件(mock):root -> id -> { name, files } */
const mockPlugins = new Map<string, Map<string, { name: string; files: Map<string, string> }>>();

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function delay(ms = 40) {
  return new Promise((r) => setTimeout(r, ms));
}

function siteJsonPath(root: string) {
  return `${root}/.plainstruct/site.json`;
}

function readJson<T>(abs: string): T | null {
  const raw = files.get(abs);
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeConfig(root: string, cfg: SiteConfig) {
  files.set(siteJsonPath(root), JSON.stringify(cfg, null, 2));
}

function touchRecent(root: string, name: string) {
  const cfg = readJson<SiteConfig>(siteJsonPath(root));
  recent = [
    { name, path: root, openedAt: Date.now() },
    ...recent.filter((s) => s.path !== root),
  ].slice(0, 8);
  lsSet(LS_RECENT, recent);
  void cfg;
}

/* ---------------- 演示站点内容 ---------------- */

const demoDocs: Record<string, string> = {
  "index.md": `---
title: 首页
order: 0
---

# 欢迎使用素构

素构(Plainstruct)是一个本地运行的静态文档站点创建器:文件夹里写 Markdown,一键构建,发布到 GitHub Pages。

- 左侧文件树管理文件夹与文档
- 编辑与实时预览左右对照
- 构建产物使用相对链接,部署在任何路径都不会乱

## 从这里开始

- [快速开始](guide/quickstart.md)
- [Markdown 语法示例](guide/markdown.md)
- [关于素构](about.md)
`,
  "guide/quickstart.md": `---
title: 快速开始
order: 1
---

# 快速开始

三步建立你的第一个站点。

## 1. 新建文档

在左侧文件树中点击「新建文档」,输入名称即可开始写作。

## 2. 构建站点

切到「构建」页,点击构建。素构会把 Markdown 渲染为静态 HTML,并保持所有链接为相对路径。

## 3. 发布

在「发布」页填入 GitHub 用户名、仓库与访问令牌,即可推送整站。

> 提示:文档之间的链接直接写 \`.md\` 相对路径,构建时会自动转换为 \`.html\`。
`,
  "guide/markdown.md": `---
title: Markdown 语法示例
order: 2
---

# Markdown 语法示例

## 文本样式

**加粗**、*斜体*、~~删除线~~、\`行内代码\`,以及[站内链接](quickstart.md)与[外部链接](https://pages.github.com/)。

## 列表

- 无序列表一项
- 无序列表二项

1. 有序列表一项
2. 有序列表二项

- [ ] 任务:写文档
- [x] 任务:装素构

## 代码

\`\`\`ts
export function greet(name: string): string {
  return \`你好,\${name}\`;
}
\`\`\`

## 表格

| 功能 | 状态 |
| --- | --- |
| 文件管理 | 可用 |
| 实时预览 | 可用 |
| 主题系统 | 可用 |

## 引用

> 简单的结构,可靠的结果。
`,
  "about.md": `---
title: 关于素构
order: 9
---

# 关于素构

素构是一个门槛低、本地运行的静态文档站点创建器。

- 技术栈:Vue 3 + TypeScript + Tauri
- 全部数据保存在你选择的文件夹里
- 主题为 ZIP 包,可导入导出
`,
};

function seedDemo() {
  if (files.has(siteJsonPath(DEMO_ROOT))) return;
  writeConfig(DEMO_ROOT, {
    name: "演示站点",
    description: "素构自带的示例文档站",
    theme: { id: "plain-light", source: "builtin", config: {} },
  });
  for (const [rel, content] of Object.entries(demoDocs)) {
    files.set(`${DEMO_ROOT}/content/${rel}`, content);
  }
}

function ensureInit() {
  seedDemo();
  settings = lsGet<AppSettings>(LS_SETTINGS, { locale: "zh-CN", autosave: true, autosaveDelay: 900, disableRefreshAnim: false, theme: "system", uiFont: "system", editorFont: "default", editorWhitespace: true, editorBreakKey: "enter", editorIndentKey: "tab", editorIndentWidth: 2 });
  recent = lsGet<RecentSite[]>(LS_RECENT, [
    { name: "演示站点", path: DEMO_ROOT, openedAt: Date.now() },
  ]);
}

/* ---------------- 树 ---------------- */

type DocOrderMap = Record<string, string[]>;

function orderPath(root: string) {
  return `${root}/.plainstruct/order.json`;
}

function readOrder(root: string): DocOrderMap {
  return readJson<DocOrderMap>(orderPath(root)) ?? {};
}

/** 与 Rust 端一致:手动顺序在前,未记录项按「目录优先 + 名称自然排序」追加在后 */
function orderCmp(map: DocOrderMap, dir: string) {
  const names = map[dir];
  const pos = names ? new Map(names.map((n, i) => [n, i])) : null;
  return (a: TreeNode, b: TreeNode) => {
    const ia = pos?.get(a.name);
    const ib = pos?.get(b.name);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return treeCollator.compare(a.name, b.name);
  };
}

/** 与 Rust 端 walk 一致:同级按手动顺序(order.json),未记录项目录优先、名称自然排序 */
const treeCollator = new Intl.Collator("zh", { numeric: true, sensitivity: "base" });

function buildTree(root: string): TreeNode[] {
  const prefix = `${root}/content/`;
  const rels = [...files.keys()]
    .filter((p) => p.startsWith(prefix))
    .map((p) => p.slice(prefix.length));
  const dirSet = new Set<string>();
  for (const rel of rels) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) dirSet.add(parts.slice(0, i).join("/"));
  }
  const nodes: TreeNode[] = [];
  const dirNodes = new Map<string, TreeNode>();
  for (const dir of [...dirSet]) {
    const parts = dir.split("/");
    const node: TreeNode = { name: parts[parts.length - 1], path: dir, type: "dir", children: [] };
    dirNodes.set(dir, node);
    const parentDir = parts.slice(0, -1).join("/");
    const parent = parentDir ? dirNodes.get(parentDir) : undefined;
    if (parent) parent.children!.push(node);
    else nodes.push(node);
  }
  for (const rel of rels) {
    const name = rel.split("/").pop()!;
    const content = files.get(`${root}/content/${rel}`) ?? "";
    const node: TreeNode = {
      name,
      path: rel,
      type: "file",
      size: new TextEncoder().encode(content).length,
      mtime: filesMtime.get(`${root}/content/${rel}`),
    };
    const parts = rel.split("/");
    const parentDir = parts.slice(0, -1).join("/");
    const parent = parentDir ? dirNodes.get(parentDir) : undefined;
    if (parent) parent.children!.push(node);
    else nodes.push(node);
  }
  const order = readOrder(root);
  const sortTree = (list: TreeNode[], dir: string): TreeNode[] => {
    list.sort(orderCmp(order, dir));
    for (const n of list) if (n.children) sortTree(n.children, n.path);
    return list;
  };
  return sortTree(nodes, "");
}

/* ---------------- 命令实现 ---------------- */

export const mock = {
  async getBootstrap(): Promise<Bootstrap> {
    ensureInit();
    await delay();
    return {
      version: __APP_VERSION__,
      platform: "browser",
      appDataDir: "(browser)",
      customDataDir: null,
      settings,
      recentSites: recent,
      pendingUpdate: null,
    };
  },

  async saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    ensureInit();
    settings = { ...settings, ...patch };
    lsSet(LS_SETTINGS, settings);
    return settings;
  },

  /** 浏览器预览无数据目录概念:保持 no-op */
  async setDataDir(_path: string | null): Promise<void> {},

  async openDataDir(): Promise<void> {},

  async createSite(dir: string, name: string, description?: string, siteType?: string): Promise<SiteConfig> {
    ensureInit();
    if ([...files.keys()].some((p) => p.startsWith(`${dir}/`)) || files.has(dir)) {
      throw new Error("occupied");
    }
    const type = siteType === "blog" ? "blog" : "docs";
    writeConfig(dir, {
      name,
      description,
      siteType: type,
      theme: { id: type === "blog" ? "blog-light" : "plain-light", source: "builtin", config: {} },
    });
    files.set(
      `${dir}/content/index.md`,
      `---\ntitle: 首页\norder: 0\n---\n\n# ${name}\n\n从这里开始写作。\n`,
    );
    currentRoot = dir;
    touchRecent(dir, name);
    return readJson<SiteConfig>(siteJsonPath(dir))!;
  },

  async openSite(dir: string): Promise<SiteConfig> {
    ensureInit();
    const cfg = readJson<SiteConfig>(siteJsonPath(dir));
    if (!cfg) throw new Error("not-a-site");
    currentRoot = dir;
    touchRecent(dir, cfg.name);
    return cfg;
  },

  async closeSite(): Promise<void> {
    currentRoot = null;
  },

    async getSiteInfo(path: string): Promise<{ siteType: string; sizeBytes: number }> {
    void path;
    return { siteType: "docs", sizeBytes: 123456 };
  },

async readSiteConfig(): Promise<SiteConfig> {
    return readJson<SiteConfig>(siteJsonPath(currentRoot!))!;
  },

  async saveSiteConfig(patch: Partial<SiteConfig>): Promise<SiteConfig> {
    const cfg = { ...readJson<SiteConfig>(siteJsonPath(currentRoot!))!, ...patch };
    writeConfig(currentRoot!, cfg);
    return cfg;
  },

  async setSiteLogo(_srcPath: string): Promise<string> {
    return "logo.png";
  },

  async removeSiteLogo(): Promise<SiteConfig> {
    const cfg = readJson<SiteConfig>(siteJsonPath(currentRoot!))!;
    delete cfg.logo;
    writeConfig(currentRoot!, cfg);
    return cfg;
  },

  async setSiteFavicon(_srcPath: string): Promise<string> {
    return "favicon.png";
  },

  async removeSiteFavicon(): Promise<SiteConfig> {
    const cfg = readJson<SiteConfig>(siteJsonPath(currentRoot!))!;
    delete cfg.favicon;
    writeConfig(currentRoot!, cfg);
    return cfg;
  },

  /* ---------- 站点插件(mock 内存虚拟文件系统) ---------- */

  async importSitePlugin(srcPaths: string[]): Promise<SitePluginEntry> {
    if (!srcPaths.length) throw new Error("未选择插件文件");
    const pluginsFor = (root: string) => {
      let m = mockPlugins.get(root);
      if (!m) {
        m = new Map();
        mockPlugins.set(root, m);
      }
      return m;
    };
    const store = pluginsFor(currentRoot!);
    let id = "";
    do {
      id = `plugin-${Date.now() % 1_000_000}-${Math.floor(Math.random() * 9973)}`;
    } while (store.has(id));
    const files = new Map<string, string>();
    let name = "";
    for (const src of srcPaths) {
      const original = src.split(/[\\/]/).pop() ?? "plugin.js";
      let stored = original;
      let i = 2;
      const dot = original.lastIndexOf(".");
      const stem = dot > 0 ? original.slice(0, dot) : original;
      const ext = dot > 0 ? original.slice(dot) : "";
      while (files.has(stored)) stored = `${stem}-${i++}${ext}`;
      files.set(stored, `/* mock 插件文件 ${original} */`);
      if (!name) name = stem || original;
    }
    store.set(id, { name, files });
    return { id, name, files: [...files.keys()], enabled: true };
  },

  async deleteSitePlugin(id: string): Promise<void> {
    mockPlugins.get(currentRoot!)?.delete(id);
  },

  async readSitePluginFiles(entries: SitePluginEntry[]): Promise<SitePluginFiles[]> {
    const store = mockPlugins.get(currentRoot!);
    if (!store) return [];
    const out: SitePluginFiles[] = [];
    for (const entry of entries) {
      const plugin = store.get(entry.id);
      if (!plugin) continue;
      out.push({
        id: entry.id,
        name: entry.name,
        files: [...plugin.files].map(([name, content]) => ({ name, content })),
      });
    }
    return out;
  },

  async listTree(): Promise<TreeNode[]> {
    await delay();
    return buildTree(currentRoot!);
  },

  async saveDocOrder(dir: string, names: string[]): Promise<void> {
    const order = readOrder(currentRoot!);
    order[dir] = names;
    files.set(orderPath(currentRoot!), JSON.stringify(order, null, 2));
  },

  async readFolderConfigs(): Promise<Record<string, FolderMeta>> {
    const raw = files.get(`${currentRoot}/.plainstruct/folders.json`);
    try {
      return raw ? (JSON.parse(raw) as Record<string, FolderMeta>) : {};
    } catch {
      return {};
    }
  },

  async writeFolderConfig(dir: string, meta: FolderMeta | null): Promise<void> {
    const key = `${currentRoot}/.plainstruct/folders.json`;
    let map: Record<string, FolderMeta> = {};
    try {
      map = JSON.parse(files.get(key) ?? "{}") as Record<string, FolderMeta>;
    } catch {
      map = {};
    }
    const clean = dir.trim().replace(/^\/+|\/+$/g, "");
    if (meta) map[clean] = meta;
    else delete map[clean];
    files.set(key, JSON.stringify(map, null, 2));
  },

  async readDocs(paths: string[]): Promise<string[]> {
    return paths.map((p) => files.get(`${currentRoot}/content/${p}`) ?? "");
  },

  async saveDoc(path: string, content: string): Promise<void> {
    const abs = `${currentRoot}/content/${path}`;
    files.set(abs, content);
    touchFile(abs);
  },

  async createDoc(dir: string, name: string, title?: string, description?: string): Promise<string> {
    // 与 Rust 端一致:用户已带 .md 后缀时不重复追加
    const base = name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
    let rel = dir ? `${dir}/${base}.md` : `${base}.md`;
    let i = 2;
    while (files.has(`${currentRoot}/content/${rel}`)) {
      rel = dir ? `${dir}/${base}-${i}.md` : `${base}-${i}.md`;
      i++;
    }
    const docTitle = title?.trim() || base;
    const descLine = description?.trim() ? `description: ${description.trim()}\n` : "";
    const abs = `${currentRoot}/content/${rel}`;
    files.set(abs, `---\ntitle: ${docTitle}\n${descLine}---\n\n正文。\n`);
    touchFile(abs);
    return rel;
  },

  async createFolder(parent: string, name: string): Promise<string> {
    return parent ? `${parent}/${name}` : name;
  },

  async renameItem(path: string, newName: string): Promise<string> {
    const parts = path.split("/");
    const isDir = !parts[parts.length - 1].includes(".");
    const parent = parts.slice(0, -1).join("/");
    const newPath = parent ? `${parent}/${newName}` : newName;
    const prefix = `${currentRoot}/content/${path}`;
    for (const key of [...files.keys()]) {
      if (key === prefix || (isDir && key.startsWith(`${prefix}/`))) {
        const moved = key.replace(prefix, `${currentRoot}/content/${newPath}`);
        files.set(moved, files.get(key)!);
        files.delete(key);
      }
    }
    // 同步手动排序:父目录条目改名;目录改名时其子树的 order 键一并更新
    const order = readOrder(currentRoot!);
    const list = order[parent];
    if (list) order[parent] = list.map((n) => (n === parts[parts.length - 1] ? newName : n));
    if (isDir) {
      const dirPrefix = `${path}/`;
      for (const k of Object.keys(order)) {
        if (k.startsWith(dirPrefix)) {
          order[`${newPath}/${k.slice(dirPrefix.length)}`] = order[k];
          delete order[k];
        }
      }
    }
    files.set(orderPath(currentRoot!), JSON.stringify(order, null, 2));
    return newPath;
  },

  async moveItem(src: string, destDir: string): Promise<string> {
    // 源已位于目标目录时为无操作,与 Rust 端行为一致
    const parent = src.split("/").slice(0, -1).join("/");
    if (parent === destDir) return src;
    const name = src.split("/").pop()!;
    const newPath = destDir ? `${destDir}/${name}` : name;
    const prefix = `${currentRoot}/content/${src}`;
    for (const key of [...files.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}/`)) {
        const moved = key.replace(prefix, `${currentRoot}/content/${newPath}`);
        files.set(moved, files.get(key)!);
        files.delete(key);
      }
    }
    // 同步手动排序:从源目录的顺序中移除;目录移动时清理其子树的 order 键
    const order = readOrder(currentRoot!);
    const list = order[parent];
    if (list) order[parent] = list.filter((n) => n !== name);
    const dirPrefix = `${src}/`;
    for (const k of Object.keys(order)) {
      if (k.startsWith(dirPrefix)) delete order[k];
    }
    files.set(orderPath(currentRoot!), JSON.stringify(order, null, 2));
    return newPath;
  },

  async deleteItem(path: string): Promise<void> {
    const prefix = `${currentRoot}/content/${path}`;
    for (const key of [...files.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}/`)) files.delete(key);
    }
    // 同步手动排序:从父目录的顺序中移除;目录删除时清理其子树的 order 键
    const parts = path.split("/");
    const order = readOrder(currentRoot!);
    const parentDir = parts.slice(0, -1).join("/");
    const list = order[parentDir];
    if (list) order[parentDir] = list.filter((n) => n !== parts[parts.length - 1]);
    const dirPrefix = `${path}/`;
    for (const k of Object.keys(order)) {
      if (k.startsWith(dirPrefix)) delete order[k];
    }
    files.set(orderPath(currentRoot!), JSON.stringify(order, null, 2));
  },

  async importFiles(srcPaths: string[], _destDir: string): Promise<number> {
    for (const src of srcPaths) {
      const name = src.split(/[\\/]/).pop()!;
      const abs = `${currentRoot}/content/${name}`;
      files.set(abs, `# ${name}\n\n(导入的文件)\n`);
      touchFile(abs);
    }
    return srcPaths.length;
  },

  /** 与 Rust 端行为一致:图片落进 content/asset/,重名加序号,返回实际文件名 */
  async importSiteImages(srcPaths: string[]): Promise<string[]> {
    const taken = new Set(
      [...files.keys()]
        .filter((k) => k.startsWith(`${currentRoot}/content/asset/`))
        .map((k) => k.slice(`${currentRoot}/content/asset/`.length)),
    );
    const names: string[] = [];
    for (const src of srcPaths) {
      const original = src.split(/[\\/]/).pop() ?? "";
      const dot = original.lastIndexOf(".");
      const stem = dot > 0 ? original.slice(0, dot) : original;
      const ext = dot > 0 ? original.slice(dot) : "";
      let name = original;
      let i = 2;
      while (taken.has(name)) name = `${stem}-${i++}${ext}`;
      taken.add(name);
      const abs = `${currentRoot}/content/asset/${name}`;
      files.set(abs, `(站点图片 ${name})`);
      touchFile(abs);
      names.push(name);
    }
    return names;
  },

  /** 与 Rust 端行为一致:复制到 content/ 下指定路径(重名加序号),返回实际 content/ 相对路径 */
  async importSiteImageTo(src: string, dest: string): Promise<string> {
    const clean = dest.trim().replace(/^\/+/, "");
    if (!clean || clean.split("/").some((seg) => seg === ".." || seg === "")) {
      throw new Error("目标路径非法");
    }
    const prefix = `${currentRoot}/content/`;
    const taken = new Set(
      [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)),
    );
    const dot = clean.lastIndexOf(".");
    const stem = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : "";
    let target = clean;
    let i = 2;
    while (taken.has(target)) target = `${stem}-${i++}${ext}`;
    const original = src.split(/[\\/]/).pop() ?? "image";
    const abs = prefix + target;
    files.set(abs, `(站点图片 ${original})`);
    touchFile(abs);
    return target;
  },

  async clearBuild(_root: string): Promise<void> {
    buildFiles = new Map();
  },

  async writeBuildFiles(_root: string, out: OutputFile[]): Promise<void> {
    await delay(60);
    for (const f of out) buildFiles.set(f.path, f.content);
  },

  async copyPaths(_root: string, _items: CopyItem[]): Promise<number> {
    return 0;
  },

  getBuildIndex(): string | null {
    return buildFiles.get("index.html") ?? null;
  },

  /** 读取构建产物中的单个文件(诊断与集成测试用) */
  getBuildFile(path: string): string | null {
    return buildFiles.get(path) ?? null;
  },

  async listCustomThemes(): Promise<ThemeMeta[]> {
    const metas: ThemeMeta[] = [];
    for (const [id, themeFiles] of customThemes) {
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(themeFiles["theme.json"] ?? "{}") as Record<string, unknown>;
      } catch {
        /* 忽略坏 JSON */
      }
      metas.push({
        id,
        name: String(meta.name ?? id),
        version: String(meta.version ?? "0.1.0"),
        author: meta.author ? String(meta.author) : undefined,
        description: meta.description ? String(meta.description) : undefined,
        config: (meta.config as ThemeMeta["config"]) ?? [],
        siteType: meta.type === "blog" ? "blog" : meta.type === "docs" ? "docs" : undefined,
        source: "custom",
      });
    }
    return metas;
  },

  async readThemeFiles(themeId: string): Promise<Record<string, string>> {
    return { ...(customThemes.get(themeId) ?? {}) };
  },

  async saveThemeFiles(themeId: string, themeFiles: Record<string, string>): Promise<void> {
    const existing = customThemes.get(themeId);
    if (existing) customThemes.set(themeId, { ...existing, ...themeFiles });
  },

  async createCustomTheme(name: string, base: Record<string, string>): Promise<ThemeMeta> {
    siteCounter++;
    const id = `custom-${siteCounter}`;
    const themeFiles = { ...base };
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(themeFiles["theme.json"] ?? "{}") as Record<string, unknown>;
    } catch {
      /* 忽略 */
    }
    meta.id = id;
    meta.name = name;
    themeFiles["theme.json"] = JSON.stringify(meta, null, 2);
    customThemes.set(id, themeFiles);
    return {
      id,
      name,
      version: String(meta.version ?? "0.1.0"),
      author: meta.author ? String(meta.author) : undefined,
      description: meta.description ? String(meta.description) : undefined,
      config: (meta.config as ThemeMeta["config"]) ?? [],
      siteType: meta.type === "blog" ? "blog" : meta.type === "docs" ? "docs" : undefined,
      source: "custom",
    };
  },

  async deleteTheme(themeId: string): Promise<void> {
    customThemes.delete(themeId);
  },

  async importThemeZip(_zipPath: string): Promise<ThemeMeta> {
    // mock 无法解压真实 zip:复制内置浅色主题作为导入结果
    const base = getBuiltinTheme("plain-light");
    siteCounter++;
    const name = `导入主题 ${siteCounter}`;
    if (base) {
      return this.createCustomTheme(name, { ...base.files });
    }
    return {
      id: `imported-${siteCounter}`,
      name,
      version: "1.0.0",
      author: "Unknown",
      description: "",
      config: [],
      source: "custom",
    };
  },

  async exportThemeZip(_files: Record<string, string>, _destPath: string): Promise<void> {
    await delay(200);
  },

  async githubReadConfig(): Promise<GithubConfig> {
    const stored = lsGet<Partial<GithubConfig>>("plainstruct.github", {});
    return {
      owner: "",
      repo: "",
      branch: "gh-pages",
      token: "",
      autoCreate: true,
      customDomain: "",
      ...stored,
      // 旧配置无账户类型字段:按个人账号处理(与后端反序列化默认值一致)
      accountType: stored.accountType === "org" ? "org" : "user",
    };
  },

  async githubSaveConfig(cfg: GithubConfig): Promise<void> {
    lsSet("plainstruct.github", cfg);
  },

  async githubVerify(cfg: GithubConfig): Promise<VerifyResult> {
    await delay(600);
    if (!cfg.token.startsWith("ghp_") && !cfg.token.startsWith("github_pat_")) {
      return { ok: false, message: "invalid-token" };
    }
    return {
      ok: true,
      user: cfg.owner || "you",
      repoExists: true,
      pagesEnabled: true,
      ownerIsOrg: cfg.accountType === "org",
      ownerMatchesUser: cfg.accountType === "user",
    };
  },

  async githubPreflight(_cfg: GithubConfig): Promise<PublishPreflight> {
    await delay(200);
    return { buildStale: false, remoteDirty: false };
  },

  async githubPagesStatus(_cfg: GithubConfig, _commit: string): Promise<PagesBuildStatus> {
    await delay(200);
    return { ready: true, errored: false, status: "built" };
  },

  async githubSync(
    cfg: GithubConfig,
    onProgress: (p: SyncProgress) => void,
  ): Promise<SyncResult> {
    const total = 12;
    for (let i = 1; i <= total; i++) {
      await delay(120);
      onProgress({ done: i, total, message: `upload ${i}/${total}` });
    }
    return {
      commitSha: "a1b2c3d4e5f6",
      pagesUrl: `https://${cfg.owner}.github.io/${cfg.repo}/`,
    };
  },

  async openPath(_path: string): Promise<void> {},

  async openExternal(_url: string): Promise<void> {
    window.open(_url, "_blank");
  },

  async logFrontend(_msg: string): Promise<void> {},

  async checkUpdate(): Promise<UpdateInfo> {
    await delay(400);
    return {
      currentVersion: __APP_VERSION__,
      latestVersion: MOCK_LATEST_VERSION,
      hasUpdate: true,
      releaseUrl: "https://github.com/MogroWang/Plainstruct/releases/latest",
      releaseNotes: "",
      publishedAt: "",
    };
  },

  /** 浏览器 mock:模拟分块下载(事件驱动进度/速度),支持暂停、取消与续传 */
  async updateDownload(): Promise<UpdateDownloadResult> {
    const version = MOCK_LATEST_VERSION;
    const assetName = `Plainstruct_${version}_Windows_x64_Portable.zip`;
    const total = 24_117_248;
    mockDownload.paused = false;
    mockDownload.cancelled = false;
    if (mockDownload.received >= total) return { version, assetName, paused: false };
    mockDownload.running = true;
    try {
      while (mockDownload.received < total) {
        if (mockDownload.cancelled) {
          mockDownload.received = 0;
          throw "update-cancelled";
        }
        if (mockDownload.paused) return { version, assetName, paused: true };
        await delay(120);
        mockDownload.received = Math.min(total, mockDownload.received + 640 * 1024 + Math.floor(Math.random() * 180_000));
        mockEmit(Events.UpdateProgress, { received: mockDownload.received, total, name: assetName, version });
      }
    } finally {
      mockDownload.running = false;
    }
    return { version, assetName, paused: false };
  },

  async updatePause(): Promise<void> {
    mockDownload.paused = true;
    while (mockDownload.running) await delay(30);
  },

  async updateCancel(): Promise<void> {
    mockDownload.cancelled = true;
    mockDownload.received = 0;
    while (mockDownload.running) await delay(30);
  },

  async updateRestartInstall(): Promise<void> {
    mockDownload.received = 0;
  },
};

/** mock 下载模拟器的共享状态(断点/暂停/取消) */
const mockDownload = { paused: false, cancelled: false, received: 0, running: false };

/** mock 模拟的「最新版本」:始终比当前应用版本新一个补丁位,版本升级后无需手动同步 */
const MOCK_LATEST_VERSION = (() => {
  const [maj, min, pat] = __APP_VERSION__.split(".").map(Number);
  return `${maj}.${min}.${(pat ?? 0) + 1}`;
})();

/** mock 模式下的文件选择:返回虚拟路径 */
export function mockPickDirectory(): string {
  siteCounter++;
  return `C:/Sites/新站点 ${siteCounter}`;
}

export function mockPickZip(): string {
  siteCounter++;
  return `C:/Downloads/theme-${siteCounter}.zip`;
}

export function mockPickImage(): string {
  return "C:/Pictures/logo.png";
}

export function mockPickPlugin(): string[] {
  siteCounter++;
  return [`C:/Downloads/plugin-${siteCounter}.js`];
}
