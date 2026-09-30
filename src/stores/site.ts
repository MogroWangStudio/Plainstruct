import { defineStore } from "pinia";
import { ipc } from "@/ipc/ipc";
import type { SiteConfig, TreeNode } from "@/ipc/types";
import { collectDocPaths, type DocsCache } from "@/lib/builder";
import { isAssetDirName, isImageFile } from "@/lib/paths";
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
}

export const useSiteStore = defineStore("site", {
  state: (): State => ({
    open: false,
    root: "",
    config: null,
    tree: [],
    treeLoading: false,
    docsCache: {},
  }),

  getters: {
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

    /** 资产目录下的全部图片文件(资产栏与资产页同源) */
    assetFiles(): TreeNode[] {
      return this.assetDirs.flatMap((d) =>
        (d.children ?? []).filter((n) => n.type === "file" && isImageFile(n.name)),
      );
    },

    /** 资产分组:每个资产目录的根层与各子文件夹各成一组(资产页分组展示与移动目标) */
    assetGroups(state): { dir: string; label: string; images: TreeNode[] }[] {
      const groups: { dir: string; label: string; images: TreeNode[] }[] = [];
      const walk = (node: TreeNode, base: string) => {
        const images = (node.children ?? []).filter((n) => n.type === "file" && isImageFile(n.name));
        if (images.length) {
          groups.push({ dir: node.path, label: node.path.slice(base.length + 1), images });
        }
        for (const c of node.children ?? []) if (c.type === "dir") walk(c, base);
      };
      for (const d of state.tree.filter((n) => n.type === "dir" && isAssetDirName(n.name))) {
        const top = (d.children ?? []).filter((n) => n.type === "file" && isImageFile(n.name));
        if (top.length) groups.push({ dir: d.path, label: "", images: top });
        for (const c of d.children ?? []) if (c.type === "dir") walk(c, d.path);
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
      await Promise.all([this.refreshTree(), theme.loadAll(), publish.load()]);
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
      const newPath = await ipc.renameItem(path, newName);
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
      const newPath = await ipc.moveItem(src, destDir);
      await this.refreshTree();
      const editor = useEditorStore();
      const active = editor.activePath;
      // 移动目录时,连同其子树内的当前文档路径一并重映射
      if (active && (active === src || active.startsWith(`${src}/`))) {
        editor.activePath = newPath + active.slice(src.length);
      }
      return newPath;
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
  },
});
