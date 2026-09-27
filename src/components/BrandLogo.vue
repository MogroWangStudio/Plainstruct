<script setup lang="ts">
/** 品牌 logo -- 与 public/logo.svg 同一图形(展平为最终坐标)。
 *  动画:隔几秒眨眼(JS 调度一次性动画,避免中途改 duration 引起相位跳变闪烁)、
 *  小幅度跟随鼠标、鼠标点按时整体下压回弹 + 眼睛眯起;
 *  窗口失焦时先转头看一看,随后闭眼睡觉(Zzz 循环)并整体变淡(透明度,随深浅主题通用);
 *  重新聚焦后透明度恢复、Zzz 渐隐、缓缓睁眼,继续眨眼与鼠标跟踪。 */
import { onBeforeUnmount, onMounted, ref } from "vue";

const props = withDefaults(defineProps<{ size?: number; /** 水平注视幅度系数:logo 靠窗口边缘(如 macOS 右上角)时减幅,避免眼神总偏向一侧 */ gazeScaleX?: number }>(), {
  size: 20,
  gazeScaleX: 1,
});

const svgEl = ref<SVGSVGElement | null>(null);

/** 清醒 → 转头张望(drowsing)→ 入睡(sleeping);聚焦后先 waking(透明度恢复、Zzz 渐隐,眼睛仍闭着),
 *  随后才回到 awake 睁开眼睛并恢复眨眼与鼠标跟踪。 */
type LogoState = "awake" | "drowsing" | "sleeping" | "waking";
const logoState = ref<LogoState>("awake");

let raf = 0;
let targetX = 0;
let targetY = 0;
let curX = 0;
let curY = 0;
let blinkTimer = 0;
let pressResetTimer = 0;
let sleepTimer = 0;
let reduceMotion = false;
let unlisten: Array<() => void> = [];

function onMove(e: MouseEvent) {
  if (logoState.value !== "awake") return;
  const svg = svgEl.value;
  if (!svg) return;
  const r = svg.getBoundingClientRect();
  // 目标位移以「屏幕像素」表达,再换算成 viewBox 单位(CSS transform 的 px 在 SVG 里等于用户单位)
  const unit = 251 / Math.max(r.width, 1);
  const dx = e.clientX - (r.left + r.width / 2);
  const dy = e.clientY - (r.top + r.height / 2);
  targetX = Math.max(-1, Math.min(1, dx / 180)) * 1.3 * unit * props.gazeScaleX;
  targetY = Math.max(-1, Math.min(1, dy / 140)) * 1.0 * unit;
  if (!raf) raf = requestAnimationFrame(tick);
}

function tick() {
  curX += (targetX - curX) * 0.12;
  curY += (targetY - curY) * 0.12;
  if (Math.abs(targetX - curX) < 0.02 && Math.abs(targetY - curY) < 0.02) {
    curX = targetX;
    curY = targetY;
    raf = 0;
  } else {
    raf = requestAnimationFrame(tick);
  }
  svgEl.value?.style.setProperty("--eye-x", curX.toFixed(2) + "px");
  svgEl.value?.style.setProperty("--eye-y", curY.toFixed(2) + "px");
}

/** 眨眼:一次性 class 动画,结束后移除,下一次由定时器重新触发 */
function blink() {
  const svg = svgEl.value;
  if (!svg) return;
  svg.classList.remove("blinking");
  void svg.getBoundingClientRect(); // 强制重排,确保 class 重新加回时动画能再次播放
  svg.classList.add("blinking");
}

function scheduleBlink() {
  blinkTimer = window.setTimeout(() => {
    blink();
    scheduleBlink();
  }, 2600 + Math.random() * 3600);
}

/** 确保眨眼循环在跑:blinkTimer === 0 表示当前无循环(被失焦清理或尚未启动) */
function ensureBlinkLoop() {
  if (!reduceMotion && blinkTimer === 0) scheduleBlink();
}

/** 鼠标点按反馈:整体轻压 + 眯眼;动画播放中忽略连点,避免抖动 */
function onPress() {
  if (logoState.value !== "awake") return;
  const svg = svgEl.value;
  if (!svg || svg.classList.contains("pressed")) return;
  svg.classList.add("pressed");
  pressResetTimer = window.setTimeout(() => svg.classList.remove("pressed"), 360);
}

/** 窗口聚焦状态:失焦 → 张望后入睡;聚焦 → 先恢复气色再睁眼 */
function setAwake(focused: boolean) {
  clearTimeout(sleepTimer);
  if (!focused) {
    svgEl.value?.classList.remove("blinking");
    clearTimeout(blinkTimer);
    blinkTimer = 0;
    // 眼神回正,不再跟踪鼠标
    targetX = 0;
    targetY = 0;
    if (!raf) raf = requestAnimationFrame(tick);
    if (reduceMotion) {
      logoState.value = "sleeping";
      return;
    }
    // 唤醒途中再度失焦:直接睡下
    if (logoState.value === "awake") logoState.value = "drowsing";
    else if (logoState.value === "waking") logoState.value = "sleeping";
    sleepTimer = window.setTimeout(() => {
      if (logoState.value === "drowsing") logoState.value = "sleeping";
    }, 980);
  } else {
    if (logoState.value === "awake") {
      // 已经清醒:确保眨眼循环在跑(自愈启动期被误清的循环)
      ensureBlinkLoop();
      return;
    }
    if (reduceMotion) {
      logoState.value = "awake";
      return;
    }
    if (logoState.value === "drowsing") {
      // 还没睡着,直接回醒
      logoState.value = "awake";
      ensureBlinkLoop();
      return;
    }
    // 先让透明度恢复、Zzz 渐隐(眼睛保持闭合),随后才睁眼并恢复眨眼循环
    logoState.value = "waking";
    sleepTimer = window.setTimeout(() => {
      if (logoState.value === "waking") {
        logoState.value = "awake";
        ensureBlinkLoop();
      }
    }, 900);
  }
}

async function watchWindowFocus() {
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      unlisten.push(await win.listen("tauri://focus", () => setAwake(true)));
      unlisten.push(await win.listen("tauri://blur", () => setAwake(false)));
      // 启动期窗口焦点尚未建立、focus 事件也可能早于监听注册,
      // 稍候再做一次初始校正,避免误判入睡后无人唤醒
      window.setTimeout(() => {
        void win.isFocused().then(setAwake);
      }, 350);
    } catch {
      /* 焦点事件不可用时保持清醒态 */
    }
  } else {
    const onBlur = () => setAwake(false);
    const onFocus = () => setAwake(true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    unlisten.push(() => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    });
  }
}

onMounted(() => {
  reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduceMotion) {
    ensureBlinkLoop();
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("pointerdown", onPress, { passive: true });
  }
  void watchWindowFocus();
});

onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onMove);
  window.removeEventListener("pointerdown", onPress);
  clearTimeout(blinkTimer);
  clearTimeout(pressResetTimer);
  clearTimeout(sleepTimer);
  if (raf) cancelAnimationFrame(raf);
  unlisten.forEach((fn) => fn());
  unlisten = [];
});
</script>

<template>
  <span class="brand-logo-wrap" :class="logoState">
    <!-- 形状与 public/logo.svg 等价:嘴(底横条)、左侧括号、15% 斜杠、双眼 -->
    <svg
      ref="svgEl"
      class="brand-logo"
      :width="props.size"
      :height="props.size"
      viewBox="0 0 251 243"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="0" y="173.13" width="250.4" height="69.01" />
      <polygon
        points="69.01,173.13 69.01,242.14 0,242.14 0,21.7 69.01,21.7 69.01,90.71 34.5,90.71 34.5,173.13"
      />
      <polygon
        points="104.06,97.24 201.31,0 235.98,34.67 138.74,131.92"
        fill-opacity="0.15"
      />
      <g class="eye-follow">
        <g class="eye-blink">
          <rect x="89.71" y="0" width="49.04" height="131.92" />
        </g>
      </g>
      <g class="eye-follow">
        <g class="eye-blink">
          <rect x="201.37" y="0" width="49.03" height="131.92" />
        </g>
      </g>
    </svg>
    <!-- 入睡时的 Zzz:三个字符错峰上飘循环,唤醒后随容器渐隐 -->
    <span class="zzz" aria-hidden="true" :style="{ fontSize: Math.max(8, Math.round(props.size * 0.42)) + 'px' }">
      <i>z</i><i>z</i><i>z</i>
    </span>
  </span>
</template>

<style scoped>
.brand-logo-wrap {
  position: relative;
  display: inline-flex;
  line-height: 0;
}

.brand-logo {
  transform-origin: center;
  /* 变淡用透明度而非颜色,深浅主题通用;入睡渐深、唤醒缓缓恢复 */
  transition: opacity 700ms var(--ease-plain);
}
.brand-logo.pressed {
  animation: logo-press 340ms var(--ease-pop);
}

/* 失焦后:整体变淡;转头张望以 logo 下部为轴小幅摆动 */
.drowsing .brand-logo,
.sleeping .brand-logo {
  opacity: 0.45;
}
.drowsing .brand-logo {
  transform-origin: 50% 80%;
  animation: logo-look 950ms cubic-bezier(0.34, 0.9, 0.35, 1) both;
}

.eye-follow {
  transform: translate(var(--eye-x, 0px), var(--eye-y, 0px));
  will-change: transform;
}
.eye-blink {
  transform-box: fill-box;
  transform-origin: center;
  /* 静止时才生效的过渡:入睡闭眼 / 唤醒缓缓睁眼(眨眼动画运行中由 animation 接管) */
  transition: transform 480ms var(--ease-plain);
}
.brand-logo.blinking .eye-blink {
  animation: eye-blink 300ms cubic-bezier(0.3, 0.6, 0.4, 1) both;
}
/* 点按反馈优先于眨眼:眯眼幅度略小,像开心地眯起来 */
.brand-logo.pressed .eye-blink {
  animation: eye-squint 340ms var(--ease-pop) both;
}
/* 睡着与苏醒中眼睛都保持闭合;进入 awake 后由过渡缓缓睁开 */
.sleeping .eye-blink,
.waking .eye-blink {
  transform: scaleY(0.08);
}

/* Zzz:三字符错峰上飘循环;醒着时隐藏(渐隐),入睡后浮现 */
.zzz {
  position: absolute;
  top: -22%;
  right: -58%;
  font-weight: 700;
  font-family: var(--font-sans, system-ui, sans-serif);
  letter-spacing: 0.05em;
  opacity: 0;
  transition: opacity 600ms var(--ease-plain);
  pointer-events: none;
}
.sleeping .zzz {
  opacity: 1;
  transition: opacity 450ms ease 250ms;
}
.zzz i {
  display: inline-block;
  font-style: normal;
  color: currentColor;
}
.zzz i:nth-child(1) {
  transform: translateY(3px) scale(0.72);
}
.zzz i:nth-child(3) {
  transform: translateY(-4px) scale(1.05);
}
.sleeping .zzz i {
  animation: zzz-rise 2.4s ease-in-out infinite;
}
.sleeping .zzz i:nth-child(1) {
  animation-delay: 0ms;
}
.sleeping .zzz i:nth-child(2) {
  animation-delay: 800ms;
}
.sleeping .zzz i:nth-child(3) {
  animation-delay: 1600ms;
}

@keyframes eye-blink {
  0% {
    transform: scaleY(1);
  }
  45% {
    transform: scaleY(0.06);
  }
  100% {
    transform: scaleY(1);
  }
}
@keyframes eye-squint {
  0% {
    transform: scaleY(1);
  }
  35% {
    transform: scaleY(0.3);
  }
  70% {
    transform: scaleY(0.45);
  }
  100% {
    transform: scaleY(1);
  }
}
@keyframes logo-press {
  0% {
    transform: scale(1);
  }
  35% {
    transform: scale(0.9, 0.94);
  }
  100% {
    transform: scale(1);
  }
}
@keyframes logo-look {
  0% {
    transform: rotate(0deg);
  }
  22% {
    transform: rotate(-9deg);
  }
  46% {
    transform: rotate(7deg);
  }
  70% {
    transform: rotate(-4deg);
  }
  100% {
    transform: rotate(0deg);
  }
}
@keyframes zzz-rise {
  0% {
    opacity: 0;
    translate: 0 4px;
  }
  25% {
    opacity: 0.9;
  }
  60% {
    opacity: 0.55;
  }
  100% {
    opacity: 0;
    translate: 5px -7px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .brand-logo.pressed,
  .brand-logo.blinking .eye-blink,
  .drowsing .brand-logo {
    animation: none;
  }
  .eye-follow {
    transform: none;
  }
  .sleeping .zzz i {
    animation: none;
  }
}
</style>
