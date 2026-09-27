import { defineStore } from "pinia";
import { ipc } from "@/ipc/ipc";
import type {
  AppSettings,
  AppTheme,
  Bootstrap,
  EditorBreakKey,
  EditorFontMode,
  EditorIndentKey,
  Locale,
  Platform,
  RecentSite,
  UiFontMode,
} from "@/ipc/types";
import { i18n, type Locale as I18nLocale } from "@/i18n";
import { appThemeDef } from "@/lib/app-themes";

export type AppView = "editor" | "site" | "build" | "theme" | "publish" | "settings" | "about";

/** 个性化外观(主题与字体) */
export interface AppearanceSettings {
  theme?: AppTheme;
  uiFont?: UiFontMode;
  uiFontCustom?: string;
  editorFont?: EditorFontMode;
  editorFontCustom?: string;
}

/** 编辑器写作偏好(空白标记与键位) */
export interface EditorPrefs {
  editorWhitespace?: boolean;
  editorBreakKey?: EditorBreakKey;
  editorIndentKey?: EditorIndentKey;
  editorIndentWidth?: number;
}

/** 常用字体栈(与素构站点主题一致) */
const FONT_STACKS: Record<"serif" | "mono", string> = {
  serif: `Georgia, "Times New Roman", "Songti SC", "SimSun", serif`,
  mono: `ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", "Microsoft YaHei", monospace`,
};

interface State {
  ready: boolean;
  bootstrap: Bootstrap | null;
  view: AppView;
  /** 系统当前是否深色(跟随系统主题用) */
  systemDark: boolean;
}

export const useAppStore = defineStore("app", {
  state: (): State => ({
    ready: false,
    bootstrap: null,
    view: "editor",
    systemDark: false,
  }),

  getters: {
    platform(): Platform {
      return this.bootstrap?.platform ?? "browser";
    },
    settings(): AppSettings {
      return (
        this.bootstrap?.settings ?? {
          locale: "zh-CN",
          autosave: true,
          theme: "system",
          uiFont: "system",
          editorFont: "default",
          editorWhitespace: true,
          editorBreakKey: "enter",
          editorIndentKey: "tab",
          editorIndentWidth: 2,
        }
      );
    },
    recentSites(): RecentSite[] {
      return this.bootstrap?.recentSites ?? [];
    },
    version(): string {
      return this.bootstrap?.version ?? "";
    },
    /** 软件当前是否处于暗色(固定深色主题,或跟随系统时取系统深浅) */
    isDark(state): boolean {
      const theme = state.bootstrap?.settings.theme ?? "system";
      if (theme === "system") return state.systemDark;
      return appThemeDef(theme).dark;
    },
  },

  actions: {
    async init() {
      this.bootstrap = await ipc.getBootstrap();
      i18n.global.locale.value = this.settings.locale as I18nLocale;
      this.applyAppearance();
      this.watchSystemTheme();
      this.ready = true;
    },

    async setLocale(locale: Locale) {
      this.bootstrap = {
        ...this.bootstrap!,
        settings: { ...this.settings, locale },
      };
      i18n.global.locale.value = locale as I18nLocale;
      await ipc.saveSettings({ locale });
    },

    async setAutosave(enabled: boolean) {
      this.bootstrap = {
        ...this.bootstrap!,
        settings: { ...this.settings, autosave: enabled },
      };
      await ipc.saveSettings({ autosave: enabled });
    },

    /** 保存个性化外观并立即应用 */
    async setAppearance(patch: AppearanceSettings) {
      this.bootstrap = {
        ...this.bootstrap!,
        settings: { ...this.settings, ...patch },
      };
      this.applyAppearance();
      await ipc.saveSettings(patch);
    },

    /** 保存编辑器写作偏好(空白标记与键位),编辑器经响应式 watch 自行重配 */
    async setEditorPrefs(patch: EditorPrefs) {
      this.bootstrap = {
        ...this.bootstrap!,
        settings: { ...this.settings, ...patch },
      };
      await ipc.saveSettings(patch);
    },

    /** 把主题与字体落到 html 根节点(data-theme + 字体变量) */
    applyAppearance() {
      if (typeof document === "undefined") return;
      const { theme, uiFont, uiFontCustom, editorFont, editorFontCustom } = this.settings;
      const root = document.documentElement;
      // 跟随系统时落到 light/dark,其余主题直接以自身 id 生效
      const preferDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const resolved = theme ?? "system";
      root.dataset.theme = resolved === "system" ? (preferDark ? "dark" : "light") : resolved;

      let ui: string | undefined;
      if (uiFont === "custom") ui = (uiFontCustom ?? "").trim() || undefined;
      else if (uiFont === "serif" || uiFont === "mono") ui = FONT_STACKS[uiFont];
      if (ui) root.style.setProperty("--font-sans", ui);
      else root.style.removeProperty("--font-sans");

      let editor: string | undefined;
      if (editorFont === "custom") editor = (editorFontCustom ?? "").trim() || undefined;
      else if (editorFont === "ui") editor = ui || undefined;
      else if (editorFont === "serif") editor = FONT_STACKS.serif;
      if (editor) root.style.setProperty("--font-editor", editor);
      else root.style.removeProperty("--font-editor");
    },

    /** 跟随系统主题:监听系统深浅色变化(仅 theme=system 时实际生效) */
    watchSystemTheme() {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      this.systemDark = media.matches;
      const handler = () => {
        this.systemDark = media.matches;
        if ((this.settings.theme ?? "system") === "system") this.applyAppearance();
      };
      if (media.addEventListener) media.addEventListener("change", handler);
      else media.addListener(handler);
    },

    setView(view: AppView) {
      this.view = view;
    },

    async refreshRecent() {
      const boot = await ipc.getBootstrap();
      this.bootstrap = { ...this.bootstrap!, recentSites: boot.recentSites };
    },

    /** 更改数据存储位置(null = 恢复默认);迁移完成后以服务端状态为准刷新 */
    async setDataDir(path: string | null) {
      await ipc.setDataDir(path);
      this.bootstrap = await ipc.getBootstrap();
    },
  },
});
