import { defineStore } from "pinia";
import { ipc } from "@/ipc/ipc";
import type { SiteType, ThemeMeta, ThemeSource } from "@/ipc/types";
import { builtinThemes } from "@/themes/manifest";
import type { ThemeBundle } from "@/lib/theme-engine";
import { useSiteStore } from "./site";
import { useBuilderStore } from "./builder";
import { useUiStore } from "./ui";

/** 主题适用的站点类型,缺省 docs(兼容旧自定义主题) */
function themeType(meta: ThemeMeta): SiteType {
  return meta.siteType ?? "docs";
}

interface State {
  builtinMetas: ThemeMeta[];
  customMetas: ThemeMeta[];
  /** 当前站点的活动主题(含文件,用于构建与预览) */
  activeBundle: ThemeBundle | null;
  /** 主题制作器正在编辑的主题 */
  editing: { id: string; name: string; files: Record<string, string> } | null;
  editingActiveFile: string;
  loading: boolean;
  /** 内置主题的配置被用户改动后置位,主题页据此弹出"复制为新主题"对话框 */
  suggestCopyForBuiltin: boolean;
  /** 本次改动周期内用户已选择"继续使用",不再重复提示;配置回到默认后复位 */
  copyPromptDismissed: boolean;
}

export const useThemeStore = defineStore("theme", {
  state: (): State => ({
    builtinMetas: builtinThemes.map((t) => t.meta),
    customMetas: [],
    activeBundle: null,
    editing: null,
    editingActiveFile: "templates/layout.hbs",
    loading: false,
    suggestCopyForBuiltin: false,
    copyPromptDismissed: false,
  }),

  getters: {
    /** 当前站点类型,决定主题列表与默认主题 */
    siteType(): SiteType {
      const site = useSiteStore();
      return site.config?.siteType ?? "docs";
    },
    builtinForSite(state): ThemeMeta[] {
      return state.builtinMetas.filter((m) => themeType(m) === this.siteType);
    },
    customForSite(state): ThemeMeta[] {
      return state.customMetas.filter((m) => themeType(m) === this.siteType);
    },
    activeMeta(state): ThemeMeta | undefined {
      const site = useSiteStore();
      const id = site.config?.theme.id;
      const pool =
        site.config?.theme.source === "custom" ? state.customMetas : state.builtinMetas;
      return pool.find((m) => m.id === id) ?? state.builtinMetas[0];
    },
    configValues(): Record<string, string | number | boolean> {
      const site = useSiteStore();
      const values = site.config?.theme.config ?? {};
      const meta = this.activeMeta;
      if (!meta) return {};
      const merged: Record<string, string | number | boolean> = {};
      for (const f of meta.config ?? []) {
        merged[f.key] = values[f.key] ?? f.default ?? "";
      }
      return merged;
    },
    /** 当前启用的内置主题是否存在偏离默认值的配置(供"已修改"标识与复制提示) */
    builtinConfigModified(): boolean {
      const site = useSiteStore();
      const ref = site.config?.theme;
      const meta = this.activeMeta;
      if (!ref || ref.source !== "builtin" || !meta) return false;
      const values = ref.config ?? {};
      return (meta.config ?? []).some((f) => {
        const v = values[f.key];
        return v !== undefined && v !== (f.default ?? "");
      });
    },
  },

  actions: {
    reset() {
      this.$reset();
    },

    /** 指定站点类型的首个内置主题(类型切换时的默认落点) */
    defaultBuiltinFor(type: SiteType): ThemeMeta | undefined {
      const meta = this.builtinMetas.find((m) => themeType(m) === type);
      return meta ?? this.builtinMetas[0];
    },

    /** 切换站点类型:配置落到对应类型的首个内置主题 */
    async applySiteType(type: SiteType) {
      const site = useSiteStore();
      const fallback = this.defaultBuiltinFor(type);
      await site.saveConfig({
        siteType: type,
        ...(fallback ? { theme: { id: fallback.id, source: "builtin" as ThemeSource, config: {} } } : {}),
      });
      await this.loadAll();
      useBuilderStore().onSiteChanged();
    },

    async loadAll() {
      this.loading = true;
      try {
        this.customMetas = await ipc.listCustomThemes();
        await this.ensureActiveBundle();
      } finally {
        this.loading = false;
      }
    },

    async ensureActiveBundle(): Promise<ThemeBundle> {
      const site = useSiteStore();
      const ref = site.config?.theme ?? { id: "plain-light", source: "builtin" as ThemeSource, config: {} };
      let bundle: ThemeBundle | undefined;
      if (ref.source === "custom") {
        const files = await ipc.readThemeFiles(ref.id);
        const meta = this.customMetas.find((m) => m.id === ref.id);
        if (meta && files["templates/layout.hbs"]) {
          bundle = { meta, files };
        }
      }
      if (!bundle) {
        bundle = builtinThemes.find((t) => t.meta.id === ref.id) ?? builtinThemes[0];
      }
      this.activeBundle = bundle;
      return bundle;
    },

    /**
     * 切换主题:仅键名与类型都兼容的配置值随身携带(共有设置不丢),
     * 其余回落到新主题默认 —— 自定义与内置主题之间切换不再「部分设置被替换」。 */
    carriedConfig(targetId: string, source: ThemeSource): Record<string, string | number | boolean> {
      const prev = useSiteStore().config?.theme.config ?? {};
      const pool = source === "builtin" ? this.builtinMetas : this.customMetas;
      const meta = pool.find((m) => m.id === targetId);
      const carried: Record<string, string | number | boolean> = {};
      for (const f of meta?.config ?? []) {
        const v = prev[f.key];
        if (v === undefined) continue;
        if (f.type === "number" && typeof v === "number") carried[f.key] = v;
        else if (f.type === "boolean" && typeof v === "boolean") carried[f.key] = v;
        else if (f.type === "select") {
          if ((f.options ?? []).includes(String(v))) carried[f.key] = String(v);
        } else if (typeof v === "string") carried[f.key] = v;
      }
      return carried;
    },

    async selectTheme(id: string, source: ThemeSource) {
      const site = useSiteStore();
      this.suggestCopyForBuiltin = false;
      this.copyPromptDismissed = false;
      await site.saveConfig({ theme: { id, source, config: this.carriedConfig(id, source) } });
      await this.loadAll();
      useBuilderStore().onSiteChanged();
    },

    /** 配置面板即时生效并持久化到站点配置 */
    async setConfigValue(key: string, value: string | number | boolean) {
      const site = useSiteStore();
      if (!site.config) return;
      const config = { ...site.config.theme.config, [key]: value };
      site.config = { ...site.config, theme: { ...site.config.theme, config } };
      await ipc.saveSiteConfig({ theme: { ...site.config.theme, config } });
      useBuilderStore().onSiteChanged();
      // 内置主题的配置被改动:置位提示,由主题页弹出"复制为新主题"对话框。
      // 用户已选"继续使用"的改动周期内不再打扰;配置回到默认后重新武装。
      if (this.builtinConfigModified) {
        if (!this.copyPromptDismissed) this.suggestCopyForBuiltin = true;
      } else {
        this.copyPromptDismissed = false;
      }
    },

    /** 用户在提示对话框中选择"继续使用" */
    dismissCopySuggestion() {
      this.suggestCopyForBuiltin = false;
      this.copyPromptDismissed = true;
    },

    /** 清空配置覆盖,当前主题恢复为默认值(内置主题即原始状态) */
    async resetConfigValues() {
      const site = useSiteStore();
      if (!site.config) return;
      this.suggestCopyForBuiltin = false;
      this.copyPromptDismissed = false;
      await site.saveConfig({ theme: { ...site.config.theme, config: {} } });
      useBuilderStore().onSiteChanged();
    },

    /** 切换到刚从内置主题复制出的自定义主题,并保留当前配置值 */
    async adoptAsCustom(id: string) {
      const site = useSiteStore();
      this.suggestCopyForBuiltin = false;
      this.copyPromptDismissed = false;
      await site.saveConfig({
        theme: { id, source: "custom", config: { ...(site.config?.theme.config ?? {}) } },
      });
      await this.loadAll();
      useBuilderStore().onSiteChanged();
    },

    async startEditing(id: string, source: ThemeSource) {
      let files: Record<string, string>;
      let meta: ThemeMeta | undefined;
      if (source === "custom") {
        files = await ipc.readThemeFiles(id);
        meta = this.customMetas.find((m) => m.id === id);
      } else {
        const builtin = builtinThemes.find((t) => t.meta.id === id);
        files = builtin ? { ...builtin.files } : {};
        meta = builtin?.meta;
      }
      if (!files["templates/layout.hbs"]) return;
      this.editing = { id, name: meta?.name ?? id, files };
      this.editingActiveFile = "templates/layout.hbs";
    },

    setEditingFile(path: string, content: string) {
      if (!this.editing) return;
      this.editing = { ...this.editing, files: { ...this.editing.files, [path]: content } };
    },

    async saveEditing() {
      if (!this.editing) return;
      const meta = this.customMetas.find((m) => m.id === this.editing!.id);
      if (!meta) return;
      const id = this.editing.id;
      await ipc.saveThemeFiles(id, this.editing.files);
      // theme.json 可能被编辑,重新读取元数据;等待期间制作器可能被退出
      await this.loadAll();
      if (!this.editing || this.editing.id !== id) return;
      await this.startEditing(id, "custom");
      useBuilderStore().onSiteChanged();
    },

    async createFrom(baseSource: ThemeSource, baseId: string, name: string) {
      const ui = useUiStore();
      // 汇集基础主题文件,由 Rust 落盘为新主题(mock 同样支持)
      let files: Record<string, string>;
      if (baseSource === "custom") {
        files = await ipc.readThemeFiles(baseId);
      } else {
        const builtin = builtinThemes.find((t) => t.meta.id === baseId);
        files = builtin ? { ...builtin.files } : {};
      }
      if (!files["templates/layout.hbs"]) {
        throw new Error("基础主题缺少模板文件");
      }
      const meta = await ipc.createCustomTheme(name, files);
      await this.loadAll();
      ui.toast(`「${name}」已创建`, "success");
      return meta;
    },

    async deleteCustom(id: string) {
      const site = useSiteStore();
      await ipc.deleteTheme(id);
      if (site.config?.theme.source === "custom" && site.config.theme.id === id) {
        await this.selectTheme("plain-light", "builtin");
      }
      await this.loadAll();
    },

    async importZip(zipPath: string) {
      const ui = useUiStore();
      const meta = await ipc.importThemeZip(zipPath);
      await this.loadAll();
      ui.toast(`「${meta.name}」已导入`, "success");
      return meta;
    },

    async exportEditing(destPath: string) {
      if (!this.editing) return;
      await ipc.exportThemeZip(this.editing.files, destPath);
    },

    async exportBuiltin(id: string, destPath: string) {
      const builtin = builtinThemes.find((t) => t.meta.id === id);
      if (builtin) await ipc.exportThemeZip(builtin.files, destPath);
    },
  },
});
