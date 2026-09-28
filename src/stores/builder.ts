import { defineStore } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { BuildReport } from "@/ipc/types";
import { buildSite } from "@/lib/builder";
import { buildIndexUrl } from "@/lib/preview";
import { useSiteStore } from "./site";
import { useThemeStore } from "./theme";
import { useAppStore } from "./app";
import { useUiStore } from "./ui";
import { i18n } from "@/i18n";

interface State {
  building: boolean;
  report: BuildReport | null;
  error: string | null;
  autoRebuild: boolean;
  /** 每次构建完成后自增,预览 iframe 以此刷新 */
  previewNonce: number;
  /** 构建进行中收到保存请求,结束后需补一次重建 */
  pendingRebuild: boolean;
}

let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

export const useBuilderStore = defineStore("builder", {
  state: (): State => ({
    building: false,
    report: null,
    error: null,
    autoRebuild: true,
    previewNonce: 0,
    pendingRebuild: false,
  }),

  actions: {
    reset() {
      if (rebuildTimer) clearTimeout(rebuildTimer);
      rebuildTimer = null;
      this.$reset();
    },

    async build() {
      const site = useSiteStore();
      const theme = useThemeStore();
      const ui = useUiStore();
      if (!site.config || this.building) return;
      this.building = true;
      this.error = null;
      try {
        const bundle = await theme.ensureActiveBundle();
        this.report = await buildSite(site.config, bundle);
        this.previewNonce++;
        // 独立预览窗口若开着,同步加载最新构建产物
        void this.refreshPreviewWindow();
      } catch (e) {
        this.error = ipcErr(e);
        ui.toast(this.error, "error");
      } finally {
        this.building = false;
        // 构建期间若有文档保存,补一次重建,避免该次改动被跳过
        if (this.pendingRebuild) {
          this.pendingRebuild = false;
          void this.build();
        }
      }
    },

    /**
     * 独立预览窗口:打开;已在则原地刷新加载最新构建(不销毁窗口,位置尺寸不重置)。
     * 新开窗口时恢复上次关闭前的位置与尺寸。
     */
    async openOrRefreshPreviewWindow() {
      const site = useSiteStore();
      const app = useAppStore();
      if (!site.root) return;
      try {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const existing = await WebviewWindow.getByLabel("site-preview");
        if (existing) {
          await invoke("reload_webview", { label: "site-preview" });
          await existing.setFocus();
          return;
        }
        const win = new WebviewWindow("site-preview", {
          url: buildIndexUrl(app.platform),
          title: `${site.config?.name ?? "Plainstruct"} · ${i18n.global.t("build.preview")}`,
          ...previewWindowRect(),
        });
        void watchPreviewWindow(win);
      } catch {
        /* 非 Tauri 环境忽略 */
      }
    },

    /** 构建完成后刷新独立预览窗口(未打开则不动作) */
    async refreshPreviewWindow() {
      try {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const existing = await WebviewWindow.getByLabel("site-preview");
        if (existing) await this.openOrRefreshPreviewWindow();
      } catch {
        /* 非 Tauri 环境忽略 */
      }
    },

    /** 文档保存或主题/站点配置变更后:已构建过则防抖重建,保持构建预览与产物同步 */
    onSiteChanged() {
      if (!this.autoRebuild || !this.report) return;
      // 构建进行中先记待办,构建结束后自动补一次
      if (this.building) {
        this.pendingRebuild = true;
        return;
      }
      if (rebuildTimer) clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => {
        void this.build();
      }, 700);
    },

    setAutoRebuild(v: boolean) {
      this.autoRebuild = v;
    },
  },
});

function ipcErr(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

/* ---------- 独立预览窗口位置记忆 ---------- */

const PREVIEW_RECT_KEY = "plainstruct.previewWindowRect";
const PREVIEW_DEFAULT_SIZE = { width: 1120, height: 760 };

/** 上次关闭前的逻辑位置与尺寸;无有效记录时回退默认尺寸并居中 */
function previewWindowRect(): {
  x?: number;
  y?: number;
  width: number;
  height: number;
  center?: boolean;
} {
  try {
    const saved = JSON.parse(localStorage.getItem(PREVIEW_RECT_KEY) ?? "") as Record<string, number>;
    if ([saved.x, saved.y, saved.width, saved.height].every((n) => Number.isFinite(n))) {
      return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
    }
  } catch {
    /* 无记录或已损坏,走默认 */
  }
  return { ...PREVIEW_DEFAULT_SIZE, center: true };
}

/** 监听预览窗口移动/缩放,防抖记录逻辑矩形;窗口销毁后停止监听 */
async function watchPreviewWindow(win: WebviewWindow) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void (async () => {
        try {
          const [pos, size, scale] = await Promise.all([
            win.outerPosition(),
            win.innerSize(),
            win.scaleFactor(),
          ]);
          localStorage.setItem(
            PREVIEW_RECT_KEY,
            JSON.stringify({
              x: Math.round(pos.x / scale),
              y: Math.round(pos.y / scale),
              width: Math.round(size.width / scale),
              height: Math.round(size.height / scale),
            }),
          );
        } catch {
          /* 窗口已关闭,忽略 */
        }
      })();
    }, 400);
  };
  try {
    const offMoved = await win.onMoved(save);
    const offResized = await win.onResized(save);
    await win.once("tauri://destroyed", () => {
      offMoved();
      offResized();
    });
  } catch {
    /* 监听失败不影响窗口使用 */
  }
}
