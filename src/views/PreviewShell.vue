<script setup lang="ts">
/** 独立预览窗口壳层:自绘标题栏 + 浏览器式导航,可随时切换桌面/移动两种模拟环境。
 *  - 桌面模式:窗口即浏览器视口,iframe 满幅铺开;
 *  - 移动模式:同一 iframe 约束进 412×915 的设备视口(缩放适配窗口),site:// 页面
 *    内注入的 shim 把指针点击镜像为真实触摸事件,并支持安卓左缘侧滑返回 ——
 *    手势裁决在页面内,整屏滑出/滑入的弹簧动画由壳层驱动(速度交接、可打断)。
 *  壳层不依赖应用 store:平台/语言/外观由窗口参数携带,页面状态由 shim 回报。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { StyleValue } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "@/components/AppIcon.vue";
import { Events, listen } from "@/ipc/events";
import { siteUrl } from "@/lib/preview";
import { springValue, type SpringHandle } from "@/lib/spring";

const { t } = useI18n();

const params = new URLSearchParams(location.search);
const platform = (params.get("platform") ?? "browser") as "windows" | "macos" | "browser";
const onMac = platform === "macos";
const onWindows = platform === "windows";
const inTauri = platform !== "browser";

/* ---------- 移动设备模拟参数 ---------- */
const SCREEN_W = 412;
const SCREEN_H = 915;
const BEZEL = 10;
const DEVICE_OUTER_W = SCREEN_W + BEZEL * 2;
const DEVICE_OUTER_H = SCREEN_H + BEZEL * 2;

/* ---------- 站点 iframe 与模式 ---------- */
const frame = ref<HTMLIFrameElement>();
const siteSrc = inTauri ? siteUrl(platform, "build/index.html") : "about:blank";

type Mode = "desktop" | "mobile";
const MODE_KEY = "plainstruct.previewMode";
const mode = ref<Mode>(readMode());

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "mobile" ? "mobile" : "desktop";
  } catch {
    return "desktop";
  }
}

/* ---------- shim 回报的页面状态 ---------- */
interface PageMsg {
  source: "ps-shim";
  type: "page";
  nav: string;
  depth: number;
  url: string;
  title: string;
}
interface BackMsg {
  source: "ps-shim";
  type: "back";
  phase: "start" | "move" | "end";
  p?: number;
  vx?: number;
  commit?: boolean;
  hasBack?: boolean;
}
type ShimMsg = PageMsg | BackMsg;

const page = ref<PageMsg | null>(null);
const fwdAvail = ref(false);
const backAvail = computed(() => (page.value?.depth ?? 1) > 1);

/** 地址栏展示站点内路径(/build/ 前缀与 index.html 不展示,与发布后的 URL 对应) */
const address = computed(() => {
  const url = page.value?.url;
  if (!url) return "";
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname)
      .replace(/^\/build\//, "/")
      .replace(/index\.html$/i, "");
    return path + u.search + u.hash;
  } catch {
    return url;
  }
});

function onWindowMessage(e: MessageEvent) {
  const data = e.data as ShimMsg | undefined;
  if (!data || data.source !== "ps-shim" || e.source !== frame.value?.contentWindow) return;
  if (data.type === "page") {
    page.value = data;
    // 前进可用性从导航类型推导:新导航清空前进栈;后退/前进落到旧条目则恢复
    if (data.nav === "navigate") fwdAvail.value = false;
    else if (data.nav === "back_forward") fwdAvail.value = true;
    if (entrancePending) startEntrance();
  } else if (data.type === "back") {
    handleGesture(data);
  }
}

/* ---------- 壳层 → 页面命令 ---------- */

function postToSite(msg: Record<string, unknown>) {
  frame.value?.contentWindow?.postMessage({ source: "ps-shell", ...msg }, "*");
}

function sendMode() {
  postToSite({ type: "mode", mode: mode.value });
}

function sendHistory(delta: number) {
  postToSite({ type: "history", delta });
}

function onFrameLoad() {
  sendMode(); // 每次页面载入后同步一次模式(shim 随新文档重置)
  // 后退入场动画可能先于/晚于 load 到达,两种顺序都不打断
  if (!entrancePending && !gestureAnim) gestureP.value = 0;
}

/** 刷新:shim 可用时 history.go(0) 原位刷新当前页(保留阅读位置),
 *  否则回到站点入口。构建完成的原位刷新走同一条路。 */
function reloadSite() {
  if (!frame.value || !inTauri) return;
  if (page.value) sendHistory(0);
  else frame.value.src = siteSrc;
}

/* ---------- 安卓侧滑返回:壳层动画层 ---------- */

const gestureP = ref(0); // 0 静止;>0 右滑滑出;<0 后退目标页从左侧入场
let gestureAnim: SpringHandle | null = null;
let entrancePending = false;

function handleGesture(d: BackMsg) {
  if (d.phase === "start") {
    if (gestureAnim) {
      gestureAnim.stop();
      gestureAnim = null;
    }
    entrancePending = false;
    gestureP.value = 0;
    return;
  }
  if (d.phase === "move") {
    gestureP.value = d.p ?? 0;
    return;
  }
  // phase === "end":按位移与松手速度裁决后的结果做弹簧收尾,
  // 松手速度换算为进度速度交接给弹簧,避免拖拽与动画之间出现速度断崖
  const vps = (d.vx ?? 0) / SCREEN_W;
  if (d.commit) {
    entrancePending = true;
    gestureAnim = springValue(
      gestureP.value,
      1.12,
      (v) => (gestureP.value = v),
      { response: 0.32, damping: 1, initialVelocity: vps },
      () => sendHistory(-1),
    );
  } else {
    gestureAnim = springValue(gestureP.value, 0, (v) => (gestureP.value = v), {
      response: 0.35,
      damping: 1,
      initialVelocity: vps,
    });
  }
}

/** 后退提交后,新页面从左侧轻推入场(与滑出同路径,方向镜像) */
function startEntrance() {
  entrancePending = false;
  gestureP.value = -0.32;
  gestureAnim = springValue(gestureP.value, 0, (v) => (gestureP.value = v), { response: 0.4, damping: 1 });
}

function stopGesture() {
  if (gestureAnim) {
    gestureAnim.stop();
    gestureAnim = null;
  }
  entrancePending = false;
  gestureP.value = 0;
}

/** 侧滑中的整屏变换:滑出 = 右移 + 轻缩 + 渐隐(预测性返回);入场自左侧收拢 */
const gestureStyle = computed<StyleValue | undefined>(() => {
  const p = gestureP.value;
  if (!p) return undefined;
  const scale = 1 - 0.1 * Math.abs(p);
  const opacity = p >= 0 ? 1 - 0.3 * p : 1 + 1.2 * p;
  return {
    transform: `translateX(${(p * 100).toFixed(3)}%) scale(${scale.toFixed(4)})`,
    opacity: Math.min(1, Math.max(0, opacity)).toFixed(3),
  };
});

/* ---------- 模式切换与设备缩放 ---------- */

const stage = ref<HTMLElement>();
const fitScale = ref(1);

watch(mode, (m) => {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* 持久化失败仅影响下次默认 */
  }
  sendMode();
  stopGesture();
  void nextTick(refit);
  void nextTick(measurePill);
});

function refit() {
  const el = stage.value;
  if (!el || mode.value !== "mobile") return;
  const availW = el.clientWidth - 48;
  const availH = el.clientHeight - 48 - 30; // 四周留白 + 底部提示行
  if (availW <= 0 || availH <= 0) return;
  fitScale.value = Math.min(1, availW / DEVICE_OUTER_W, availH / DEVICE_OUTER_H);
}

/** 布局尺寸取缩放后的设备外框,缩放经 transform 呈现,避免溢出产生滚动 */
const holderStyle = computed<StyleValue | undefined>(() =>
  mode.value !== "mobile"
    ? undefined
    : {
        width: `${(DEVICE_OUTER_W * fitScale.value).toFixed(2)}px`,
        height: `${(DEVICE_OUTER_H * fitScale.value).toFixed(2)}px`,
      },
);
const fitStyle = computed<StyleValue | undefined>(() =>
  mode.value !== "mobile"
    ? undefined
    : {
        width: `${DEVICE_OUTER_W}px`,
        height: `${DEVICE_OUTER_H}px`,
        transform: `scale(${fitScale.value.toFixed(4)})`,
      },
);

/* ---------- 自绘标题栏:模式分段控件(滑动药丸)与窗口控制 ---------- */

const btnDesktop = ref<HTMLElement>();
const btnMobile = ref<HTMLElement>();
const pillStyle = ref<{ left: string; width: string }>({ left: "0px", width: "0px" });

function measurePill() {
  const el = mode.value === "desktop" ? btnDesktop.value : btnMobile.value;
  if (!el) return;
  pillStyle.value = { left: `${el.offsetLeft}px`, width: `${el.offsetWidth}px` };
}

const maximized = ref(false);

async function winAction(action: "minimize" | "toggleMaximize" | "close") {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  if (action === "minimize") await win.minimize();
  else if (action === "toggleMaximize") {
    await win.toggleMaximize();
    maximized.value = await win.isMaximized();
  } else await win.close();
}

/* ---------- 生命周期 ---------- */

let resizeObserver: ResizeObserver | null = null;
let unlistenRebuilt: (() => void) | null = null;

onMounted(() => {
  void nextTick(measurePill);
  if (stage.value) {
    resizeObserver = new ResizeObserver(refit);
    resizeObserver.observe(stage.value);
  }
  window.addEventListener("message", onWindowMessage);
  if (inTauri) {
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        await win.show(); // 壳层就绪后自显
        maximized.value = await win.isMaximized();
      } catch {
        /* 显示失败交由创建端兜底定时器 */
      }
      try {
        unlistenRebuilt = await listen(Events.PreviewRebuilt, () => reloadSite());
      } catch {
        /* 监听失败不影响预览 */
      }
    })();
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("message", onWindowMessage);
  unlistenRebuilt?.();
  stopGesture();
});
</script>

<template>
  <div class="shell">
    <!-- 自绘标题栏:拖拽区覆盖空白处,按钮各自 no-drag -->
    <header class="bar" data-tauri-drag-region @dblclick="onWindows && winAction('toggleMaximize')">
      <span v-if="onMac" class="mac-space" data-tauri-drag-region></span>
      <div v-if="inTauri" class="nav">
        <button class="btn-icon" :disabled="!backAvail" :title="t('previewShell.back')" @click="sendHistory(-1)">
          <AppIcon name="arrowLeft" :size="16" />
        </button>
        <button class="btn-icon" :disabled="!fwdAvail" :title="t('previewShell.forward')" @click="sendHistory(1)">
          <AppIcon name="arrowRight" :size="16" />
        </button>
        <button class="btn-icon" :title="t('previewShell.reload')" @click="reloadSite">
          <AppIcon name="refresh" :size="15" />
        </button>
      </div>
      <div class="addr" data-tauri-drag-region>
        <span class="addr-pill" data-tauri-drag-region :title="page?.url ?? ''">
          {{ address || t("previewShell.blank") }}
        </span>
      </div>
      <span v-if="mode === 'mobile'" class="spec" :title="t('previewShell.deviceSpec')">{{ SCREEN_W }} × {{ SCREEN_H }}</span>
      <div class="modes" role="group" :aria-label="t('previewShell.modeLabel')">
        <span class="modes-pill" :style="pillStyle" aria-hidden="true"></span>
        <button
          ref="btnDesktop"
          class="mode-btn"
          :class="{ active: mode === 'desktop' }"
          :aria-pressed="mode === 'desktop'"
          @click="mode = 'desktop'"
        >
          <AppIcon name="monitor" :size="15" />
          <span>{{ t("previewShell.desktop") }}</span>
        </button>
        <button
          ref="btnMobile"
          class="mode-btn"
          :class="{ active: mode === 'mobile' }"
          :aria-pressed="mode === 'mobile'"
          @click="mode = 'mobile'"
        >
          <AppIcon name="smartphone" :size="15" />
          <span>{{ t("previewShell.mobile") }}</span>
        </button>
      </div>
      <div v-if="onWindows" class="win-controls">
        <button class="btn-icon" :title="t('titlebar.minimize')" @click="winAction('minimize')">
          <AppIcon name="minus" :size="14" />
        </button>
        <button class="btn-icon" :title="maximized ? t('titlebar.restore') : t('titlebar.maximize')" @click="winAction('toggleMaximize')">
          <AppIcon :name="maximized ? 'restore' : 'maximize'" :size="13" />
        </button>
        <button class="btn-icon close" :title="t('titlebar.close')" @click="winAction('close')">
          <AppIcon name="x" :size="14" />
        </button>
      </div>
    </header>

    <!-- 内容区:同一 iframe 在两种模式间重排,切换不重载站点 -->
    <div ref="stage" class="content">
      <div v-if="!inTauri" class="mock-note">{{ t("previewShell.browserOnly") }}</div>
      <div class="holder" :class="mode === 'mobile' ? 'is-mobile' : 'is-desktop'" :style="holderStyle">
        <div class="fit" :style="fitStyle">
          <div class="screen">
            <div class="behind" aria-hidden="true"></div>
            <div class="gesture" :style="mode === 'mobile' ? gestureStyle : undefined">
              <iframe
                ref="frame"
                class="site"
                :src="siteSrc"
                title="site preview"
                @load="onFrameLoad"
              />
            </div>
          </div>
        </div>
      </div>
      <p v-if="mode === 'mobile' && inTauri" class="hint">{{ t("previewShell.swipeHint") }}</p>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  /* 视口高度:#app 无确定高度,100% 会塌缩(内容区 flex:1 1 0 将得到 0 高) */
  height: 100vh;
  background: var(--color-bg);
}

/* ---------- 自绘标题栏 ---------- */
.bar {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 44px;
  flex: none;
  padding: 0 8px 0 6px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-line);
  user-select: none;
}
.bar button {
  -webkit-app-region: no-drag;
}
.mac-space {
  width: 76px;
  flex: none;
}
.nav {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.addr {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  justify-content: center;
  padding: 0 8px;
}
.addr-pill {
  max-width: 420px;
  width: 100%;
  text-align: center;
  font-family: var(--font-mono);
  font-size: calc(12px * var(--ui-font-scale));
  color: var(--color-ink-2);
  background: var(--color-surface-2);
  border-radius: 999px;
  padding: 3px 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.spec {
  flex: none;
  font-family: var(--font-mono);
  font-size: calc(11px * var(--ui-font-scale));
  color: var(--color-ink-3);
  padding: 0 4px;
}

/* 模式分段控件:滑动药丸指示选中段,缓动与全应用一致 */
.modes {
  position: relative;
  display: flex;
  flex: none;
  background: var(--color-surface-2);
  border-radius: 8px;
  padding: 2px;
}
.modes-pill {
  position: absolute;
  top: 2px;
  bottom: 2px;
  background: var(--color-surface);
  border-radius: 6px;
  box-shadow: var(--shadow-popover);
  transition:
    left var(--duration-base) var(--ease-plain),
    width var(--duration-base) var(--ease-plain);
}
.mode-btn {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: calc(12.5px * var(--ui-font-scale));
  font-weight: var(--font-weight-ui);
  color: var(--color-ink-2);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-plain);
}
.mode-btn.active {
  color: var(--color-ink);
  font-weight: 500;
}

.win-controls {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: none;
  margin-left: 2px;
}
.win-controls .close:hover {
  background: var(--color-danger);
  color: var(--color-on-accent);
}

/* ---------- 内容区:同一 iframe 在两种模式间重排 ---------- */
.content {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  background: var(--color-surface-2);
  overflow: hidden;
}
.holder {
  position: relative;
  /* flex 容器内两轴居中;桌面模式占满 100% 时不生效 */
  margin: auto;
}
.holder.is-desktop {
  width: 100%;
  height: 100%;
}
.fit {
  width: 100%;
  height: 100%;
}
/* 移动模式:.fit 以未缩放设备尺寸布局(内联样式给出),从左上角原点缩放,
   视觉外框恰好落回 .holder 的居中盒内;默认中心原点会向右下偏移出窗口 */
.holder.is-mobile .fit {
  transform-origin: 0 0;
}
.screen {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--color-surface);
}
.holder.is-mobile .screen {
  /* 设备机身:固定深色边环(硬件不随应用主题),圆角 + 窗口阴影托起 */
  box-sizing: border-box;
  border: 10px solid #1b1917;
  border-radius: 44px;
  box-shadow: var(--shadow-window);
}
.behind {
  position: absolute;
  inset: 0;
  background: var(--color-surface-3);
}
.gesture {
  position: absolute;
  inset: 0;
  background: var(--color-surface);
  will-change: transform;
}
.site {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
.hint {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 10px;
  margin: 0;
  text-align: center;
  font-size: calc(12px * var(--ui-font-scale));
  color: var(--color-ink-3);
  pointer-events: none;
}
.mock-note {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(13px * var(--ui-font-scale));
  color: var(--color-ink-3);
}

@media (prefers-reduced-motion: reduce) {
  .modes-pill,
  .mode-btn {
    transition: none;
  }
}
</style>
