import { defineStore } from "pinia";
import { ipc } from "@/ipc/ipc";
import type { SiteConfig, SitePluginEntry, SitePluginFiles, TreeNode } from "@/ipc/types";
import { collectDocPaths, walkTree, type DocsCache } from "@/lib/builder";
import { enabledPlugins, normalizePlugins } from "@/lib/plugins";
import { remapDocRefsForMove } from "@/lib/imageRefs";
import { basename, dirname, isAssetDirName, isImageFile, isMarkdown, stripExt } from "@/lib/paths";
import { parseFrontMatter } from "@/lib/frontmatter";
import { useEditorStore } from "./editor";
import { useBuilderStore } from "./builder";
import { useThemeStore } from "./theme";
import { usePublishStore } from "./publish";
import { useAppStore } from "./app";

interface State {
  open: boolean;
  root: string;
  config: SiteConfig | null;
  tree: TreeNode[];
  treeLoading: boolean;
  /** 全部文档内容缓存(content/ 路径 -> 正文),预览与构建共用 */
  docsCache: DocsCache;
  /** 用户插件的文件内容(预览通道内联注入;构建走磁盘拷贝,不用它) */
  pluginContents: SitePluginFiles[];
}

export const useSiteStore = defineStore("site", {
  state: (): State => ({
    open: false,
    root: "",
    config: null,
    tree: [],
    treeLoading: false,
    docsCache: {},
    pluginContents: [],
  }),

  getters: {
    /** 博客主页配置头的候选文章(全部非隐藏文章,排除各级 index.md;标题取配置头或文件名)。
     *  非博客站点返回 null —— 配置头弹窗据此显示/隐藏「主页」配置区 */
    blogHomePostOptions(state): { title: string; path: string }[] | null {
      if ((state.config?.siteType ?? "docs") !== "blog") return null;
      const out: { title: string; path: string }[] = [];
      walkTree(state.tree, (node) => {
        if (node.type !== "file" || !isMarkdown(node.path)) return;
        if (basename(node.path).toLowerCase() === "index.md") return;
        const { data } = parseFrontMatter(state.docsCache[node.path] ?? "");
        if (data.hidden === true) return;
        out.push({ title: data.title ?? stripExt(node.name), path: node.path });
      });
      return out;
    },

    docCount(state): number {
      const count = (nodes: TreeNode[]): number =>
        nodes.reduce(
          (n, node) => n + (node.type === "file" && /\.md$/i.test(node.name) ? 1 : 0) + (node.children ? count(node.children) : 0),
          0,
        );
      return count(state.tree);
    },

    /** 站点资产目录(asset,兼容旧 images) */
    assetDirs(state): TreeNode[] {
      return state.tree.filter((n) => n.type === "dir" && isAssetDirName(n.name));
    },

    /** 资产目录下的全部图片文件(资产栏与资产页同源;含各层子文件夹中的图片) */
    assetFiles(): TreeNode[] {
      const out: TreeNode[] = [];
      const walk = (node: TreeNode) => {
        for (const c of node.children ?? []) {
          if (c.type === "file" && isImageFile(c.name)) out.push(c);
          else if (c.type === "dir") walk(c);
        }
      };
      for (const d of this.assetDirs) walk(d);
      return out;
    },

    /** 资产分组:每个资产目录的根层与各子文件夹各成一组(资产页分组展示与移动目标)。
     *  空文件夹也列入(新建文件夹后立即可见、可作为拖放目标),images 可能为空数组。 */
    assetGroups(state): { dir: string; label: string; images: TreeNode[] }[] {
      const groups: { dir: string; label: string; images: TreeNode[] }[] = [];
      const imagesIn = (node: TreeNode) =>
        (node.children ?? []).filter((n) => n.type === "file" && isImageFile(n.name));
      const walk = (node: TreeNode, base: string) => {
        for (const c of node.children ?? []) {
          if (c.type !== "dir") continue;
          groups.push({ dir: c.path, label: c.path.slice(base.length + 1), images: imagesIn(c) });
          walk(c, base);
        }
      };
      for (const d of state.tree.filter((n) => n.type === "dir" && isAssetDirName(n.name))) {
        groups.push({ dir: d.path, label: "", images: imagesIn(d) });
        walk(d, d.path);
      }
      return groups;
    },
  },

  actions: {
    async create(dir: string, name: string, description?: string, siteType?: string) {
      this.config = await ipc.createSite(dir, name, description, siteType);
      this.root = dir;
      this.open = true;
      await this.afterOpen();
    },

    async openDir(dir: string) {
      this.config = await ipc.openSite(dir);
      this.root = dir;
      this.open = true;
      await this.afterOpen();
    },

    async afterOpen() {
      const editor = useEditorStore();
      const theme = useThemeStore();
      const publish = usePublishStore();
      editor.reset();
      useBuilderStore().reset();
      publish.reset();
      await Promise.all([this.refreshTree(), theme.loadAll(), publish.load(), this.refreshPluginContents()]);
      // 默认打开首页
      const index = this.findDoc("index.md");
      if (index) await editor.openDoc(index);
      useAppStore().setView("editor");
    },

    findDoc(path: string): TreeNode | null {
      const walk = (nodes: TreeNode[]): TreeNode | null => {
        for (const n of nodes) {
          if (n.type === "file" && n.path.toLowerCase() === path.toLowerCase()) return n;
          const hit = n.children ? walk(n.children) : null;
          if (hit) return hit;
        }
        return null;
      };
      return walk(this.tree);
    },

    async close() {
      const editor = useEditorStore();
      if (editor.dirty) await editor.save();
      await ipc.closeSite();
      this.$reset();
      useEditorStore().reset();
      useBuilderStore().reset();
      useThemeStore().reset();
      usePublishStore().reset();
      await useAppStore().refreshRecent();
    },

    async refreshTree() {
      this.treeLoading = true;
      try {
        this.tree = await ipc.listTree();
        await this.loadDocs();
      } finally {
        this.treeLoading = false;
      }
    },

    /**
     * 手动排序:落盘某目录的子项顺序,并把本地树同步重排为「记录项在前,其余保持原有相对顺序」,
     * 与 Rust 端 walk 的排序语义一致,无需整树刷新。
     */
    async saveOrder(dir: string, names: string[]) {
      await ipc.saveDocOrder(dir, names);
      const apply = (nodes: TreeNode[], parent: string): TreeNode[] => {
        if (parent !== dir) {
          return nodes.map((n) => (n.type === "dir" ? { ...n, children: apply(n.children ?? [], n.path) } : n));
        }
        const pos = new Map(names.map((n, i) => [n, i]));
        return [...nodes]
          .map((n, i) => ({ n, i }))
          .sort((a, b) => {
            const ia = pos.get(a.n.name);
            const ib = pos.get(b.n.name);
            if (ia !== undefined && ib !== undefined) return ia - ib;
            if (ia !== undefined) return -1;
            if (ib !== undefined) return 1;
            return a.i - b.i;
          })
          .map((x) => x.n);
      };
      this.tree = apply(this.tree, "");
    },

    async loadDocs() {
      const paths = collectDocPaths(this.tree);
      if (!paths.length) {
        this.docsCache = {};
        return;
      }
      const contents = await ipc.readDocs(paths);
      const cache: DocsCache = {};
      paths.forEach((p, i) => (cache[p] = contents[i] ?? ""));
      this.docsCache = cache;
    },

    updateDocCache(path: string, content: string) {
      this.docsCache = { ...this.docsCache, [path]: content };
    },

    async saveConfig(patch: Partial<SiteConfig>) {
      this.config = await ipc.saveSiteConfig(patch);
    },

    async setLogo(srcPath: string) {
      const stored = await ipc.setSiteLogo(srcPath);
      this.config = await ipc.saveSiteConfig({ logo: stored });
    },

    async removeLogo() {
      this.config = await ipc.removeSiteLogo();
    },

    async setFavicon(srcPath: string) {
      const stored = await ipc.setSiteFavicon(srcPath);
      this.config = await ipc.saveSiteConfig({ favicon: stored });
    },

    async removeFavicon() {
      this.config = await ipc.removeSiteFavicon();
    },

    /* ---------- 内容操作 ---------- */

    async createDoc(dir: string, name: string, title?: string, description?: string) {
      const path = await ipc.createDoc(dir, name, title, description);
      await this.refreshTree();
      await useEditorStore().openDoc(this.findDoc(path) ?? { name, path, type: "file" });
    },

    async createFolder(parent: string, name: string) {
      await ipc.createFolder(parent, name);
      await this.refreshTree();
    },

    async renameItem(path: string, newName: string) {
      // 目录重命名会改变其子树内文档的目录前缀,文内相对引用需换算(文件改名目录不变,无须处理)
      const movedDocs = this.findDoc(path)?.type === "dir" ? this.mdDocsUnder(path) : [];
      const newPath = await ipc.renameItem(path, newName);
      await this.remapMovedDocs([{ from: path, to: newPath }], movedDocs);
      await this.refreshTree();
      const editor = useEditorStore();
      const active = editor.activePath;
      // 重命名目录时,连同其子树内的当前文档路径一并重映射
      if (active && (active === path || active.startsWith(`${path}/`))) {
        editor.activePath = newPath + active.slice(path.length);
      }
      return newPath;
    },

    async moveItem(src: string, destDir: string) {
      const movedDocs = this.mdDocsUnder(src);
      const newPath = await ipc.moveItem(src, destDir);
      await this.remapMovedDocs([{ from: src, to: newPath }], movedDocs);
      await this.refreshTree();
      const editor = useEditorStore();
      const active = editor.activePath;
      // 移动目录时,连同其子树内的当前文档路径一并重映射
      if (active && (active === src || active.startsWith(`${src}/`))) {
        editor.activePath = newPath + active.slice(src.length);
      }
      return newPath;
    },

    /** 批量移动(资产页多选拖放):逐个落盘后只刷新一次树,返回旧新路径对 */
    async moveItems(srcs: string[], destDir: string): Promise<{ from: string; to: string }[]> {
      const movedDocs = srcs.flatMap((src) => this.mdDocsUnder(src));
      const moved: { from: string; to: string }[] = [];
      for (const src of srcs) {
        if (dirname(src) === destDir) continue;
        moved.push({ from: src, to: await ipc.moveItem(src, destDir) });
      }
      if (!moved.length) return moved;
      await this.remapMovedDocs(moved, movedDocs);
      await this.refreshTree();
      const editor = useEditorStore();
      const active = editor.activePath;
      if (active) {
        const hit = moved.find((m) => active === m.from || active.startsWith(`${m.from}/`));
        if (hit) editor.activePath = hit.to + active.slice(hit.from.length);
      }
      return moved;
    },

    /** 移动/重命名前收集受影响的 md 文档(自身或子树内;树尚是旧路径) */
    mdDocsUnder(path: string): string[] {
      const out: string[] = [];
      const walk = (nodes: TreeNode[]) => {
        for (const n of nodes) {
          if (n.path === path || n.path.startsWith(`${path}/`)) {
            if (n.type === "file" && /\.md$/i.test(n.name)) out.push(n.path);
            if (n.children?.length) walk(n.children);
          }
        }
      };
      walk(this.tree);
      return out;
    },

    /** 文档(或目录)挪了位置后,把文内相对引用(图片/封面/站内链接)
     *  换算到新目录并落盘;当前打开且未保存的文档同步改写编辑器内容 */
    async remapMovedDocs(moves: { from: string; to: string }[], docPaths: string[]) {
      const editor = useEditorStore();
      for (const oldPath of docPaths) {
        const move = moves.find((m) => oldPath === m.from || oldPath.startsWith(`${m.from}/`));
        if (!move || move.from === move.to) continue;
        const newPath = move.to + oldPath.slice(move.from.length);
        // 打开中的文档以编辑器内容为准(可能含未保存修改);改写后同步 savedContent
        // 并直接落盘到新路径,避免自动保存把旧内容写回已移走的旧路径
        const base = editor.activePath === oldPath ? editor.content : this.docsCache[oldPath];
        if (base === undefined) continue;
        const next = remapDocRefsForMove(oldPath, newPath, base);
        if (next === base) continue;
        if (editor.activePath === oldPath) {
          editor.externalReplace = true;
          editor.content = next;
          editor.savedContent = next;
        }
        await ipc.saveDoc(newPath, next);
        this.docsCache = { ...this.docsCache, [newPath]: next };
      }
    },

    /** 批量删除(资产页多选):同样只刷新一次树 */
    async deleteItems(paths: string[]) {
      const editor = useEditorStore();
      const active = editor.activePath;
      if (active && paths.some((p) => active === p || active.startsWith(`${p}/`))) editor.reset();
      for (const p of paths) await ipc.deleteItem(p);
      await this.refreshTree();
    },

    async deleteItem(path: string) {
      // 先重置编辑器再删除:等待删除期间 autosave 可能把已删文件按旧内容复活
      const editor = useEditorStore();
      const active = editor.activePath;
      if (active && (active === path || active.startsWith(`${path}/`))) editor.reset();
      await ipc.deleteItem(path);
      await this.refreshTree();
    },

    async importFiles(srcPaths: string[], destDir: string) {
      const n = await ipc.importFiles(srcPaths, destDir);
      await this.refreshTree();
      return n;
    },

    /** 站点图片统一导入(落至 content/asset/),树刷新后资产栏即可见;
     *  导入的图片被文档引用时构建产物需要重新拷贝,同通道触发防抖重建 */
    async importSiteImages(srcPaths: string[]) {
      const names = await ipc.importSiteImages(srcPaths);
      if (names.length) {
        await this.refreshTree();
        void useBuilderStore().onSiteChanged();
      }
      return names;
    },

    /* ---------- 站点插件 ---------- */

    /** 预载启用插件的文件内容(站点打开与插件增删、开关切换后调用) */
    async refreshPluginContents() {
      const entries = this.config ? enabledPlugins(this.config) : [];
      this.pluginContents = entries.length ? await ipc.readSitePluginFiles(entries) : [];
    },

    /** 写回插件配置并触发防抖重建(产物与预览都依赖插件注入) */
    async savePlugins(patch: {
      search?: boolean;
      imgPreview?: boolean;
      imgPreviewRequireMark?: string;
      searchStyle?: "button" | "bar";
      searchPosition?: "bottom-right" | "bottom-left" | "topbar";
      custom?: SitePluginEntry[];
    }) {
      if (!this.config) return;
      const current = normalizePlugins(this.config);
      await this.saveConfig({
        plugins: {
          search: patch.search ?? current.search,
          imgPreview: patch.imgPreview ?? current.imgPreview,
          imgPreviewRequireMark: patch.imgPreviewRequireMark ?? current.imgPreviewRequireMark,
          searchStyle: patch.searchStyle ?? current.searchStyle,
          searchPosition: patch.searchPosition ?? current.searchPosition,
          custom: patch.custom ?? current.custom,
        },
      });
      await this.refreshPluginContents();
      void useBuilderStore().onSiteChanged();
    },

    /** 导入插件文件(多选合并为一个条目);取消选择返回 false */
    async importPlugin(): Promise<boolean> {
      const paths = await ipc.pickPluginFiles();
      if (!paths?.length) return false;
      const entry = await ipc.importSitePlugin(paths);
      const current = this.config ? normalizePlugins(this.config) : { search: true, imgPreview: true, custom: [] };
      await this.savePlugins({ custom: [...current.custom, entry] });
      return true;
    },

    async removePlugin(id: string) {
      const current = this.config ? normalizePlugins(this.config) : { search: true, imgPreview: true, custom: [] };
      await ipc.deleteSitePlugin(id);
      await this.savePlugins({ custom: current.custom.filter((e) => e.id !== id) });
    },

    async setPluginEnabled(id: string, enabled: boolean) {
      const current = this.config ? normalizePlugins(this.config) : { search: true, imgPreview: true, custom: [] };
      await this.savePlugins({
        custom: current.custom.map((e) => (e.id === id ? { ...e, enabled } : e)),
      });
    },
  },
});
