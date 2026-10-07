import { defineStore } from "pinia";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import type { BuildReport } from "@/ipc/types";
import { Events, listen } from "@/ipc/events";
import { buildSite } from "@/lib/builder";
import { useSiteStore } from "./site";
import { useThemeStore } from "./theme";
import { useAppStore } from "./app";
import { useUiStore } from "./ui";
import { normalizeUiFontSize, normalizeUiFontWeight } from "./app";
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
  /** 独立预览窗口当前是否打开(供界面开关按钮同步状态) */
  previewWindowOpen: boolean;
}

let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
/** 浏览器 mock 下打开的壳层标签页(命名窗口,可复用与关闭) */
let browserPreviewTab: Window | null = null;
/** 预览窗口「立即重建」请求的监听只绑定一次(预览窗口可能反复开关) */
let previewBuildListenerBound = false;
/** 预览窗口的生命周期监听只在窗口未被跟踪时绑定(webview 重载后监听器会丢失,复用窗口时需补绑) */
let previewWindowWatched = false;

/** 监听独立预览窗口的构建请求:绕过防抖立即重建,完成后由构建流程
 *  通知预览窗口原位刷新(预览壳层没有 bootstrap,构建只能托主窗口代劳) */
function bindPreviewBuildListener() {
  if (previewBuildListenerBound) return;
  previewBuildListenerBound = true;
  void listen(Events.PreviewBuildRequested, () => {
    void useBuilderStore().build();
  });
}

export const useBuilderStore = defineStore("builder", {
  state: (): State => ({
    building: false,
    report: null,
    error: null,
    autoRebuild: true,
    previewNonce: 0,
    pendingRebuild: false,
    previewWindowOpen: false,
  }),

  actions: {
    reset() {
      if (rebuildTimer) clearTimeout(rebuildTimer);
      rebuildTimer = null;
      this.$reset();
    },

    /** 构建站点;返回是否成功(失败已 toast,调用方可据此决定后续动作) */
    async build(): Promise<boolean> {
      const site = useSiteStore();
      const theme = useThemeStore();
      const ui = useUiStore();
      if (!site.config || this.building) return false;
      // 钉死发起构建时的站点根:落盘命令携 root 交后端校验,构建期间切站时
      // 旧构建被拒绝,产物不会写入新站点目录
      const root = site.root;
      this.building = true;
      this.error = null;
      try {
        const bundle = await theme.ensureActiveBundle();
        const report = await buildSite(site.config, bundle, root);
        // 构建期间已切换/关闭站点:丢弃过期结果,不污染新会话
        if (site.root !== root) return false;
        this.report = report;
        this.previewNonce++;
        // 独立预览窗口若开着,同步加载最新构建产物
        void this.refreshPreviewWindow();
        return true;
      } catch (e) {
        // 站点已切换:旧构建被后端拒绝属预期,静默即可
        if (site.root !== root) return false;
        this.error = ipcErr(e);
        ui.toast(this.error, "error");
        return false;
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
     * 独立预览窗口:打开自绘壳层(不加载站点本身);已在则原地刷新加载最新
     * 构建产物并聚焦。新开窗口时恢复上次关闭前的位置与尺寸。
     */
    async openOrRefreshPreviewWindow() {
      const site = useSiteStore();
      const app = useAppStore();
      if (!site.root) return;
      bindPreviewBuildListener();
      // 浏览器 mock:以命名标签页打开壳层页面(site:// 协议不可用,壳层仅演示界面形态;
      // 命名窗口让重复打开复用同一标签,与 Tauri 侧 getByLabel 的语义一致)
      if (app.platform === "browser") {
        const title = `${site.config?.name ?? "Plainstruct"} · ${i18n.global.t("build.preview")}`;
        browserPreviewTab = window.open(previewShellUrl(app, title), "plainstruct-preview");
        // 弹窗被拦截时 open 返回 null:不开就不同步开关状态,避免按钮卡在「已开启」
        if (browserPreviewTab) {
          browserPreviewTab.focus();
          this.previewWindowOpen = true;
        }
        return;
      }
      try {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const existing = await WebviewWindow.getByLabel("site-preview");
        // 窗口被关闭后的同步兜底:tauri://destroyed 可能因 webview 重载而丢失,
        // 复用窗口时补绑生命周期监听(标志位防止重复绑定)
        const markClosed = () => {
          previewWindowWatched = false;
          this.previewWindowOpen = false;
        };
        if (existing) {
          this.previewWindowOpen = true;
          if (!previewWindowWatched) {
            previewWindowWatched = true;
            void watchPreviewWindow(existing, markClosed);
          }
          await this.notifyPreviewRebuilt();
          await existing.unminimize().catch(() => undefined);
          await existing.setFocus();
          return;
        }
        const onMac = app.platform === "macos";
        const title = `${site.config?.name ?? "Plainstruct"} · ${i18n.global.t("build.preview")}`;
        const win = new WebviewWindow("site-preview", {
          url: previewShellUrl(app, title),
          title,
          ...previewWindowRect(),
          minWidth: 620,
          minHeight: 440,
          // macOS 保留原生圆角与阴影,红绿灯以 Overlay 悬浮在自绘标题栏上;
          // 其余平台无边框,窗口控制由壳层自绘(与主窗口同一策略)。
          // y 的实测换算:tao 把标题栏容器高设为「按钮高(14)+y」且按钮贴容器底 9px,
          // 按钮中心距窗口顶 = y-2,顶栏 44px 居中即中心 22 → y = 24(与主窗口同法实测标定)
          decorations: onMac,
          ...(onMac
            ? { titleBarStyle: "overlay" as const, hiddenTitle: true, trafficLightPosition: new LogicalPosition(10, 24) }
            : {}),
          // 壳层就绪后自显,避免无装饰窗口内容就绪前的白屏闪烁
          visible: false,
          dragDropEnabled: false,
        });
        this.previewWindowOpen = true;
        previewWindowWatched = true;
        void watchPreviewWindow(win, markClosed);
        // 创建失败(如 label 冲突)走异步 error 事件而非 throw:复位开关状态
        void win.once("tauri://error", markClosed);
        // 兜底:壳层启动失败时窗口将永不显示,2s 后强制显示以便暴露问题
        setTimeout(() => void win.show().catch(() => undefined), 2000);
      } catch {
        /* 非 Tauri 环境忽略 */
      }
    },

    /**
     * 切到独立预览窗口(不改变开合;最小化/隐藏时先还原再聚焦)。
     * 返回是否真的切换成功 —— 窗口实际不存在(状态脱节/标签页已关)时返回 false,
     * 调用方可回退为重新打开。
     */
    async focusPreviewWindow(): Promise<boolean> {
      if (useAppStore().platform === "browser") {
        if (browserPreviewTab && !browserPreviewTab.closed) {
          browserPreviewTab.focus();
          return true;
        }
        // 壳层标签页已被用户关闭:开关状态复位,由调用方重新打开
        this.previewWindowOpen = false;
        return false;
      }
      try {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const existing = await WebviewWindow.getByLabel("site-preview");
        if (!existing) {
          // 窗口已不存在但标志仍为开:复位,让按钮回到「未开启」语义
          this.previewWindowOpen = false;
          return false;
        }
        await existing.unminimize().catch(() => undefined);
        await existing.show().catch(() => undefined);
        await existing.setFocus();
        return true;
      } catch {
        /* 非 Tauri 环境忽略 */
        return false;
      }
    },

    /** 同步独立预览窗口开关状态(应用启动/进入编辑页时调用一次) */
    async syncPreviewWindowOpen() {
      try {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        this.previewWindowOpen = !!(await WebviewWindow.getByLabel("site-preview"));
      } catch {
        this.previewWindowOpen = false;
      }
    },

    /** 构建完成后让独立预览窗口原位刷新(未打开则不动作,不抢焦点) */
    async refreshPreviewWindow() {
      try {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const existing = await WebviewWindow.getByLabel("site-preview");
        if (existing) await this.notifyPreviewRebuilt();
      } catch {
        /* 非 Tauri 环境忽略 */
      }
    },

    /** 向壳层广播「产物已更新」;壳层原位重载站点页,窗口位置/模式等状态不动 */
    async notifyPreviewRebuilt() {
      try {
        const { emitTo } = await import("@tauri-apps/api/event");
        await emitTo("site-preview", Events.PreviewRebuilt, { nonce: this.previewNonce });
      } catch {
        /* 窗口可能已被关闭 */
      }
    },

    /** 文档保存或主题/站点配置变更后:已构建过则防抖重建,保持构建预览与产物同步 */
    onSiteChanged() {
      if (!this.autoRebuild) return;
      // 构建进行中先记待办,构建结束后自动补一次(首次构建同样适用:
      // 否则首建飞行期间的保存会被丢弃,产物停留在旧内容)
      if (this.building) {
        this.pendingRebuild = true;
        return;
      }
      // 从未手动构建过时不自动生成产物(产品语义),仅构建中的补建例外
      if (!this.report) return;
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

/** 壳层页面地址:携带平台/语言/外观快照,壳层不依赖 bootstrap 命令即可自举 */
function previewShellUrl(app: ReturnType<typeof useAppStore>, title: string): string {
  const preferDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const themeSetting = app.settings.theme ?? "system";
  const params = new URLSearchParams({
    platform: app.platform,
    locale: app.settings.locale,
    theme: themeSetting === "system" ? (preferDark ? "dark" : "light") : themeSetting,
    fontScale: String(normalizeUiFontSize(app.settings.uiFontSize)),
    fontWeight: String(normalizeUiFontWeight(app.settings.uiFontWeight)),
    title,
  });
  return `preview.html?${params.toString()}`;
}

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

/** 监听预览窗口移动/缩放,防抖记录逻辑矩形;窗口销毁后停止监听并回调状态同步 */
async function watchPreviewWindow(win: WebviewWindow, onClosed?: () => void) {
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
      onClosed?.();
    });
  } catch {
    /* 监听失败不影响窗口使用 */
  }
}
