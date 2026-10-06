import { defineStore } from "pinia";
import { ipc } from "@/ipc/ipc";
import { Events, listen } from "@/ipc/events";
import type {
  AppSettings,
  AppTheme,
  Bootstrap,
  ConfettiLevel,
  EditorBreakKey,
  EditorFontMode,
  EditorIndentKey,
  Locale,
  Platform,
  RecentSite,
  UiFontMode,
  UpdateProgress,
} from "@/ipc/types";
import { i18n, type Locale as I18nLocale } from "@/i18n";
import { appThemeDef } from "@/lib/app-themes";
import { useUiStore } from "./ui";

export type AppView = "editor" | "assets" | "site" | "build" | "theme" | "publish" | "settings" | "about";

/**
 * 自动更新阶段:idle=未开始 downloading=下载中 paused=已暂停(可续传)
 * ready=已就绪待「重启并更新」 error=失败
 */
export type UpdatePhase = "idle" | "downloading" | "paused" | "ready" | "error";

/** 速度平滑采样的上一次进度事件 */
let lastSpeedSample: { received: number; ts: number } | null = null;

/** 个性化外观(主题与字体) */
export interface AppearanceSettings {
  theme?: AppTheme;
  uiFont?: UiFontMode;
  uiFontCustom?: string;
  uiFontSize?: number;
  uiFontWeight?: number;
  editorFont?: EditorFontMode;
  editorFontCustom?: string;
  /** 弹窗遮罩的背景模糊(默认开) */
  modalBlur?: boolean;
}

/** 编辑器写作偏好(空白标记、键位、自动保存行为与预览刷新动画) */
export interface EditorPrefs {
  editorWhitespace?: boolean;
  editorBreakKey?: EditorBreakKey;
  editorIndentKey?: EditorIndentKey;
  editorIndentWidth?: number;
  autosaveDelay?: number;
  disableRefreshAnim?: boolean;
}

/** 常用字体栈(与素构站点主题一致) */
const FONT_STACKS: Record<"serif" | "mono", string> = {
  serif: `Georgia, "Times New Roman", "Songti SC", "SimSun", serif`,
  mono: `ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", "Microsoft YaHei", monospace`,
};

/** 界面字号缩放边界(滑块范围):只缩放文字,布局随内容自适应 */
export const UI_FONT_SCALE_MIN = 0.85;
export const UI_FONT_SCALE_MAX = 1.3;
/** 界面字重边界(滑块范围):作用于未显式指定字重的界面文本 */
export const UI_FONT_WEIGHT_MIN = 400;
export const UI_FONT_WEIGHT_MAX = 600;

/** 界面字号归一:数值 clamp 到滑块范围;旧版本档位枚举映射为缩放系数 */
export function normalizeUiFontSize(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.min(UI_FONT_SCALE_MAX, Math.max(UI_FONT_SCALE_MIN, v));
  }
  const legacy: Record<string, number> = { small: 0.9, default: 1, large: 1.1, xlarge: 1.25 };
  return legacy[String(v)] ?? 1;
}

/** 界面字重归一:数值取整并 clamp;旧版本档位枚举映射为字重值 */
export function normalizeUiFontWeight(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.min(UI_FONT_WEIGHT_MAX, Math.max(UI_FONT_WEIGHT_MIN, Math.round(v)));
  }
  const legacy: Record<string, number> = { normal: 400, medium: 500, semibold: 600 };
  return legacy[String(v)] ?? 400;
}

/** 自动保存延迟的缺省与边界(毫秒):历史数据缺字段或非法时按缺省处理 */
export const AUTOSAVE_DELAY_DEFAULT = 900;
export const AUTOSAVE_DELAY_MIN = 300;
export const AUTOSAVE_DELAY_MAX = 5000;

/** 自动保存延迟归一:取整并 clamp 到设置档位范围 */
export function normalizeAutosaveDelay(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return AUTOSAVE_DELAY_DEFAULT;
  return Math.min(AUTOSAVE_DELAY_MAX, Math.max(AUTOSAVE_DELAY_MIN, n));
}

interface State {
  ready: boolean;
  bootstrap: Bootstrap | null;
  view: AppView;
  /** 系统当前是否深色(跟随系统主题用) */
  systemDark: boolean;
  /** 自动更新阶段与下载进度(0-100,无总大小时为 -1 表示不确定) */
  updatePhase: UpdatePhase;
  updateProgress: number;
  /** 下载速度(bytes/s)与已接收/总大小(用于展示) */
  updateSpeed: number;
  updateReceived: number;
  updateTotal: number | null;
  /** 更新包文件名与目标版本 */
  updateName: string;
  updateVersion: string;
  updateError: string;
  /** 「重启并更新」执行中:防止重复拉起向导 */
  restartUpdating: boolean;
}

export const useAppStore = defineStore("app", {
  state: (): State => ({
    ready: false,
    bootstrap: null,
    view: "editor",
    systemDark: false,
    updatePhase: "idle",
    updateProgress: 0,
    updateSpeed: 0,
    updateReceived: 0,
    updateTotal: null,
    updateName: "",
    updateVersion: "",
    updateError: "",
    /** 「重启并更新」执行中:防止重复拉起向导 */
    restartUpdating: false,
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
          autosaveDelay: AUTOSAVE_DELAY_DEFAULT,
          disableRefreshAnim: false,
          theme: "system",
          uiFont: "system",
          uiFontSize: 1,
          uiFontWeight: 400,
          editorFont: "default",
          editorWhitespace: true,
          editorBreakKey: "enter",
          editorIndentKey: "tab",
          editorIndentWidth: 2,
          modalBlur: true,
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
      // 初始化失败会让启动画面滞留,必须留下诊断线索;并以默认设置降级启动,
      // 保证界面可用(getter 对 bootstrap 缺失均有回退)
      try {
        await this.initInner();
      } catch (e) {
        const msg = ipc.errText(e);
        console.error("[boot] init failed:", e);
        void ipc.logFrontend(`[boot] init failed: ${msg}`);
        this.ready = true;
      }
    },

    async initInner() {
      this.bootstrap = await ipc.getBootstrap();
      // locale 缺失/损坏时回退默认,避免 vue-i18n 对非字符串 locale 抛错
      i18n.global.locale.value = (this.settings.locale as I18nLocale) || "zh-CN";
      this.applyAppearance();
      this.watchSystemTheme();
      this.watchUpdateProgress();
      // 恢复已下载待安装的更新(「重启并更新」跨重启保持可用)
      const pending = this.bootstrap.pendingUpdate;
      if (pending) {
        this.updatePhase = "ready";
        this.updateVersion = pending.version;
        this.updateName = pending.assetName;
      }
      this.ready = true;
      // 启动自愈链路的成功终点:清零连续失败计数
      void ipc.reportBootSuccess();
    },

    /** 监听更新包下载进度事件:驱动进度、速度与包名展示 */
    async watchUpdateProgress() {
      await listen<UpdateProgress>(Events.UpdateProgress, (p) => {
        if (this.updatePhase !== "downloading") return;
        const now = performance.now();
        const prev = lastSpeedSample;
        if (prev && p.received > prev.received) {
          const dt = (now - prev.ts) / 1000;
          if (dt >= 0.08) {
            const inst = (p.received - prev.received) / dt;
            this.updateSpeed = this.updateSpeed > 0 ? this.updateSpeed * 0.55 + inst * 0.45 : inst;
          }
        } else if (p.received < (prev?.received ?? 0)) {
          this.updateSpeed = 0; // 服务器不支持续传,从头下载
        }
        lastSpeedSample = { received: p.received, ts: now };
        if (p.name) this.updateName = p.name;
        if (p.version) this.updateVersion = p.version;
        this.updateReceived = p.received;
        this.updateTotal = p.total;
        this.updateProgress = p.total && p.total > 0 ? Math.round((p.received / p.total) * 100) : -1;
      });
    },

    /** 重置下载展示状态(取消/失败时回到初始) */
    resetDownloadState() {
      this.updatePhase = "idle";
      this.updateProgress = 0;
      this.updateSpeed = 0;
      this.updateReceived = 0;
      this.updateTotal = null;
      this.updateName = "";
      this.updateVersion = "";
      this.updateError = "";
      lastSpeedSample = null;
    },

    /** 下载(或从断点续传)更新包;完成后进入「重启并更新」 */
    async updateDownload() {
      const ui = useUiStore();
      const t = i18n.global.t;
      const fresh = this.updatePhase === "idle" || this.updatePhase === "error";
      this.updatePhase = "downloading";
      this.updateError = "";
      if (fresh) {
        this.updateProgress = 0;
        this.updateSpeed = 0;
        this.updateReceived = 0;
        this.updateTotal = null;
        lastSpeedSample = null;
      }
      try {
        const r = await ipc.updateDownload();
        this.updateVersion = r.version;
        this.updateName = r.assetName;
        this.updatePhase = r.paused ? "paused" : "ready";
        this.updateSpeed = 0;
      } catch (e) {
        this.updateError = ipc.errText(e);
        if (this.updateError === "update-cancelled") {
          this.resetDownloadState();
          return;
        }
        this.updatePhase = "error";
        ui.toast(t("settings.updateDownloadFailed", { msg: this.updateError }), "error");
      }
    },

    /** 暂停下载:保留断点,可继续 */
    async pauseDownload() {
      if (this.updatePhase !== "downloading") return;
      this.updatePhase = "paused";
      this.updateSpeed = 0;
      await ipc.updatePause();
    },

    /** 继续下载(从断点续传) */
    async resumeDownload() {
      if (this.updatePhase !== "paused") return;
      await this.updateDownload();
    },

    /** 取消下载/放弃已就绪的更新:清理任务文件与更新包 */
    async cancelDownload() {
      try {
        await ipc.updateCancel();
      } finally {
        this.resetDownloadState();
      }
    },

    /** 检测到新版本时询问用户是否立即下载更新 */
    async confirmUpdate(version: string): Promise<boolean> {
      const ui = useUiStore();
      const t = i18n.global.t;
      return ui.confirmDialog({
        title: t("settings.updateAskTitle"),
        body: t("settings.updateAskBody", { v: version }),
        confirmText: t("settings.updateAskConfirm"),
      });
    },

    /** 重启并更新:拉起更新向导,由向导关闭应用并完成安装后启动新版本 */
    async confirmRestart(version: string): Promise<boolean> {
      const ui = useUiStore();
      const t = i18n.global.t;
      return ui.confirmDialog({
        title: t("settings.updateRestartAskTitle"),
        body: t("settings.updateRestartAskBody", { v: version }),
        confirmText: t("settings.updateRestartAskConfirm"),
      });
    },

    async restartToUpdate() {
      if (this.restartUpdating) return;
      const ui = useUiStore();
      const t = i18n.global.t;
      this.restartUpdating = true;
      try {
        await ipc.updateRestartInstall();
        // 应用交给更新向导:向导确认窗体就绪后结束应用并继续安装(浏览器 mock 为空操作)
      } catch (e) {
        ui.toast(t("settings.updateRestartFailed", { msg: ipc.errText(e) }), "error");
      } finally {
        this.restartUpdating = false;
      }
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

    /** 保存发布成功彩带程度 */
    async setConfetti(level: ConfettiLevel) {
      this.bootstrap = {
        ...this.bootstrap!,
        settings: { ...this.settings, confetti: level },
      };
      await ipc.saveSettings({ confetti: level });
    },

    /** 即时应用外观(不落盘):滑块拖动中调用,松手后再 setAppearance 持久化 */
    previewAppearance(patch: AppearanceSettings) {
      this.bootstrap = {
        ...this.bootstrap!,
        settings: { ...this.settings, ...patch },
      };
      this.applyAppearance();
    },

    /** 保存个性化外观并立即应用 */
    async setAppearance(patch: AppearanceSettings) {
      this.previewAppearance(patch);
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

    /** 把主题与字体落到 html 根节点(data-theme + 字体变量 + 缩放/字重) */
    applyAppearance() {
      if (typeof document === "undefined") return;
      const { theme, uiFont, uiFontCustom, uiFontSize, uiFontWeight, editorFont, editorFontCustom } = this.settings;
      const root = document.documentElement;
      // 跟随系统时落到 light/dark,其余主题直接以自身 id 生效
      const preferDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const resolved = theme ?? "system";
      root.dataset.theme = resolved === "system" ? (preferDark ? "dark" : "light") : resolved;

      // 界面字号:只缩放文字(--ui-font-scale 乘算所有界面字号),布局随内容自适应
      root.style.setProperty("--ui-font-scale", String(normalizeUiFontSize(uiFontSize)));

      // 界面字重:落到基础字重变量,标题/按钮等显式加重的元素不受影响
      root.style.setProperty("--font-weight-ui", String(normalizeUiFontWeight(uiFontWeight)));

      // 弹窗遮罩的背景模糊开关:data 属性驱动 base.css 的 .modal-scrim 规则
      root.dataset.modalBlur = this.settings.modalBlur === false ? "off" : "on";

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
