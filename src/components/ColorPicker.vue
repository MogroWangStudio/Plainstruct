<script setup lang="ts">
/** 自定义取色器 —— 触发器是色块 + 十六进制值,面板含饱和度/明度区、色相条与 HEX 输入。
 *
 *  交互:按下即响应(不等抬手),拖动以指针捕获 1:1 跟随(拖出面板也不脱手),面板锚定
 *  触发器原点弹出、沿同一路径收回,拖动中可随时反向;色相条与明度/饱和度区支持方向键
 *  微调(Shift 十倍步长),十六进制可直接键入。
 *  拖动中的取值按节流写入(视觉零延迟,只降低落盘频率),松手立即提交最终值。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toCssPx, uiZoom } from "@/lib/scale";

const props = withDefaults(
  defineProps<{
    /** 十六进制色值(如 #c8553d);非法值忽略,保留当前取值 */
    modelValue: string;
    /** 无障碍名称:通常传字段标签 */
    label?: string;
  }>(),
  { label: "" },
);

const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();

const { t } = useI18n();

/* ---------- 颜色换算 ---------- */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** 解析 #rgb / #rrggbb(不带 # 也可);非法返回 null */
function parseHex(value: string): Rgb | null {
  const s = (value ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) {
    return {
      r: parseInt(s[0] + s[0], 16),
      g: parseInt(s[1] + s[1], 16),
      b: parseInt(s[2] + s[2], 16),
    };
  }
  if (/^[0-9a-f]{6}$/i.test(s)) {
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
  }
  return null;
}

function rgbHex({ r, g, b }: Rgb): string {
  const part = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

function rgbToHsv({ r, g, b }: Rgb): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const sn = s / 100;
  const vn = v / 100;
  const c = vn * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = vn - c;
  const seg: [number, number, number] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return { r: (seg[0] + m) * 255, g: (seg[1] + m) * 255, b: (seg[2] + m) * 255 };
}

/* ---------- 取值状态 ---------- */

const h = ref(0);
const s = ref(0);
const v = ref(0);

/** 当前色(十六进制小写) */
const hex = computed(() => rgbHex(hsvToRgb(h.value, s.value, v.value)));

/** 饱和度/明度底板:横向白→纯色、纵向透明→黑叠加。这里的渐变不是氛围装饰,
 *  它本身就是取色坐标轴(横轴饱和度、纵轴明度),每个像素都是可选中的色值 */
const svBackground = computed(
  () =>
    // deslop-ignore-next-line 06
    `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h.value} 100% 50%))`,
);

/** 从外部值装载内部 HSV:灰阶保留色相、纯黑保留饱和度,
 *  否则「先选中黑白再拖色相/明度」会没有可见变化,手感像坏了 */
function loadFromProp(value: string) {
  const parsed = parseHex(value);
  if (!parsed) return;
  const hsv = rgbToHsv(parsed);
  if (hsv.s > 0.01) h.value = hsv.h;
  if (hsv.v > 0.01) s.value = hsv.s;
  v.value = hsv.v;
}

const hexDraft = ref(hex.value);
const hexEl = ref<HTMLInputElement | null>(null);
/** 本组件刚写出去的值:外部回来时视为回显,不再回灌,避免拖动中互相拉扯 */
let lastEmitted: string | null = null;

watch(
  () => props.modelValue,
  (value) => {
    if (value === lastEmitted) return;
    lastEmitted = null;
    loadFromProp(value);
    hexDraft.value = hex.value;
  },
  { immediate: true },
);

watch(hex, (value) => {
  // 用户正在键入十六进制时不打断输入
  if (document.activeElement === hexEl.value) return;
  hexDraft.value = value;
});

/* ---------- 提交节流 ---------- */

/** 拖动中的写入间隔:落盘不必每像素一次,视觉反馈仍由本地状态零延迟驱动 */
const COMMIT_MS = 80;
let commitTimer: number | null = null;
let pendingHex: string | null = null;

function commit(value: string, immediate = false) {
  pendingHex = value;
  if (!immediate) {
    if (commitTimer !== null) return;
    commitTimer = window.setTimeout(flush, COMMIT_MS);
    return;
  }
  flush();
}

function flush() {
  if (commitTimer !== null) {
    clearTimeout(commitTimer);
    commitTimer = null;
  }
  const next = pendingHex;
  pendingHex = null;
  if (!next || next === props.modelValue) return;
  lastEmitted = next;
  emit("update:modelValue", next);
}

/* ---------- 浮层定位 ---------- */

const PANEL_W = 244;
const PANEL_H = 232;

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const svEl = ref<HTMLElement | null>(null);
const hueEl = ref<HTMLElement | null>(null);
const open = ref(false);
const flipUp = ref(false);
const alignRight = ref(false);
/** 固定定位的面板坐标(传送出滚动容器,避免被裁剪) */
const pos = ref<{ top?: string; bottom?: string; left?: string; right?: string }>({ left: "0" });

function placePanel() {
  const el = trigger.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const z = uiZoom();
  // 界面缩放(zoom)下:rect 与视口在视觉像素中比较,定位值经 toCssPx 还原为 CSS 像素
  flipUp.value = r.bottom + 8 + PANEL_H * z > window.innerHeight - 8;
  alignRight.value = r.left + PANEL_W * z > window.innerWidth - 8;
  pos.value = {
    ...(alignRight.value ? { right: toCssPx(window.innerWidth - r.right) + "px" } : { left: toCssPx(r.left) + "px" }),
    ...(flipUp.value
      ? { bottom: toCssPx(window.innerHeight - r.top + 6) + "px" }
      : { top: toCssPx(r.bottom + 6) + "px" }),
  };
}

async function toggle() {
  if (open.value) {
    close();
    return;
  }
  placePanel();
  hexDraft.value = hex.value;
  open.value = true;
  await nextTick();
  svEl.value?.focus();
}

/** refocus:仅键盘用法(列如 Esc)把焦点交回触发器,指针操作不抢焦点 */
function close(refocus = false) {
  flush();
  open.value = false;
  if (refocus) trigger.value?.focus();
}

function onDocPointer(e: PointerEvent) {
  if (!open.value) return;
  const target = e.target as Node;
  if (root.value?.contains(target) || panelEl.value?.contains(target)) return;
  close();
}

function onPanelKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.stopPropagation();
    close(true);
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointer, true);
  // 滚动/改变尺寸时收起,避免面板与触发器脱节
  window.addEventListener("scroll", () => close(), true);
  window.addEventListener("resize", () => close());
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointer, true);
  window.removeEventListener("scroll", () => close(), true);
  window.removeEventListener("resize", () => close());
  if (commitTimer !== null) clearTimeout(commitTimer);
});

/* ---------- 饱和度/明度区 ---------- */

const svDragging = ref(false);

function svAt(e: PointerEvent) {
  const el = svEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  s.value = clamp(((e.clientX - r.left) / r.width) * 100, 0, 100);
  v.value = clamp((1 - (e.clientY - r.top) / r.height) * 100, 0, 100);
  commit(hex.value);
}

function svDown(e: PointerEvent) {
  const el = svEl.value;
  if (!el) return;
  el.setPointerCapture(e.pointerId);
  svDragging.value = true;
  svAt(e);
}

function svMove(e: PointerEvent) {
  if (svDragging.value) svAt(e);
}

function svUp(e: PointerEvent) {
  if (!svDragging.value) return;
  svDragging.value = false;
  try {
    svEl.value?.releasePointerCapture(e.pointerId);
  } catch {
    /* 指针已失效:忽略 */
  }
  commit(hex.value, true);
}

function svKey(e: KeyboardEvent) {
  const step = e.shiftKey ? 10 : 1;
  if (e.key === "ArrowLeft") s.value = clamp(s.value - step, 0, 100);
  else if (e.key === "ArrowRight") s.value = clamp(s.value + step, 0, 100);
  else if (e.key === "ArrowUp") v.value = clamp(v.value + step, 0, 100);
  else if (e.key === "ArrowDown") v.value = clamp(v.value - step, 0, 100);
  else return;
  e.preventDefault();
  commit(hex.value, true);
}

/* ---------- 色相条 ---------- */

const hueDragging = ref(false);

function hueAt(e: PointerEvent) {
  const el = hueEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  h.value = clamp(((e.clientX - r.left) / r.width) * 360, 0, 360);
  commit(hex.value);
}

function hueDown(e: PointerEvent) {
  const el = hueEl.value;
  if (!el) return;
  el.setPointerCapture(e.pointerId);
  hueDragging.value = true;
  hueAt(e);
}

function hueMove(e: PointerEvent) {
  if (hueDragging.value) hueAt(e);
}

function hueUp(e: PointerEvent) {
  if (!hueDragging.value) return;
  hueDragging.value = false;
  try {
    hueEl.value?.releasePointerCapture(e.pointerId);
  } catch {
    /* 指针已失效:忽略 */
  }
  commit(hex.value, true);
}

function hueKey(e: KeyboardEvent) {
  const step = e.shiftKey ? 10 : 1;
  if (e.key === "ArrowLeft") h.value = (h.value - step + 360) % 360;
  else if (e.key === "ArrowRight") h.value = (h.value + step) % 360;
  else return;
  e.preventDefault();
  commit(hex.value, true);
}

/* ---------- 十六进制输入 ---------- */

function onHexInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  hexDraft.value = raw;
  const parsed = parseHex(raw);
  // 半成品(用户还在敲)不提交,也不改内部 HSV
  if (!parsed) return;
  const hsv = rgbToHsv(parsed);
  if (hsv.s > 0.01) h.value = hsv.h;
  if (hsv.v > 0.01) s.value = hsv.s;
  v.value = hsv.v;
  commit(rgbHex(parsed), true);
}
</script>

<template>
  <div ref="root" class="picker">
    <button
      ref="trigger"
      type="button"
      class="picker-field"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-label="label ? `${label} ${t('theme.colorPick')}` : t('theme.colorPick')"
      @click="toggle"
    >
      <span class="picker-field-swatch" :style="{ background: hex }" aria-hidden="true" />
      <span class="picker-field-hex mono">{{ hex }}</span>
    </button>

    <Teleport to="body">
      <Transition name="picker-pop">
        <div
          v-if="open"
          ref="panelEl"
          class="picker-panel"
          :style="{
            ...pos,
            transformOrigin: `${flipUp ? 'bottom' : 'top'} ${alignRight ? 'right' : 'left'}`,
          }"
          role="dialog"
          :aria-label="label ? `${label} ${t('theme.colorPick')}` : t('theme.colorPick')"
          @keydown="onPanelKeydown"
        >
          <!-- 饱和度(横)/ 明度(纵):按下即在指针位置取色,拖动 1:1 跟随 -->
          <div
            ref="svEl"
            class="picker-sv"
            :class="{ 'is-dragging': svDragging }"
            :style="{ background: svBackground }"
            tabindex="0"
            role="group"
            :aria-label="t('theme.colorPickArea')"
            @pointerdown="svDown"
            @pointermove="svMove"
            @pointerup="svUp"
            @pointercancel="svUp"
            @keydown="svKey"
          >
            <span class="picker-dot" :style="{ left: s + '%', top: 100 - v + '%' }" aria-hidden="true" />
          </div>

          <!-- 色相 -->
          <div
            ref="hueEl"
            class="picker-hue"
            :class="{ 'is-dragging': hueDragging }"
            tabindex="0"
            role="slider"
            aria-orientation="horizontal"
            :aria-valuemin="0"
            :aria-valuemax="360"
            :aria-valuenow="Math.round(h)"
            :aria-label="t('theme.colorPickHue')"
            @pointerdown="hueDown"
            @pointermove="hueMove"
            @pointerup="hueUp"
            @pointercancel="hueUp"
            @keydown="hueKey"
          >
            <span class="picker-dot picker-dot-hue" :style="{ left: (h / 360) * 100 + '%', background: `hsl(${h} 100% 50%)` }" aria-hidden="true" />
          </div>

          <div class="picker-foot">
            <span class="picker-swatch" :style="{ background: hex }" aria-hidden="true" />
            <input
              ref="hexEl"
              class="input picker-hex mono"
              type="text"
              spellcheck="false"
              autocomplete="off"
              :aria-label="t('theme.colorHex')"
              :value="hexDraft"
              @input="onHexInput"
              @blur="hexDraft = hex"
              @keydown.enter="flush"
            />
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
  display: inline-block;
}

/* 触发器:与应用内选择框同高同形,色块即当前色,右侧是可直接读出的十六进制值 */
.picker-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px 0 8px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md, 6px);
  background: var(--color-bg);
  color: var(--color-ink);
  cursor: pointer;
  transition:
    border-color var(--duration-base) var(--ease-plain),
    background-color var(--duration-base) var(--ease-plain),
    transform 100ms ease-out;
}
.picker-field:hover,
.picker-field[aria-expanded="true"] {
  border-color: var(--color-line-strong);
  background: var(--color-surface);
}
.picker-field:active {
  transform: scale(0.98);
}
.picker-field:focus-visible {
  outline: none;
  border-color: var(--color-line-strong);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}
.picker-field-swatch {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  /* 取色结果不限深浅:描边随主题墨色变化,深色主题下黑块也不会糊在底色里 */
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-ink) 22%, transparent);
}
.picker-field-hex {
  font-size: calc(12px * var(--ui-font-scale));
  color: var(--color-ink-2);
}
@media (prefers-reduced-motion: reduce) {
  .picker-field:active {
    transform: none;
  }
}
</style>

<style>
/* 面板传送至 body,样式不随宿主 scoped */
.picker-panel {
  position: fixed;
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 244px;
  padding: 10px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-xl, 10px);
  background: var(--color-surface);
  box-shadow: var(--shadow-popover);
}

.picker-sv {
  position: relative;
  height: 148px;
  border-radius: 8px;
  cursor: crosshair;
  /* 触摸拖动由指针事件接管,不触发页面滚动 */
  touch-action: none;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-ink) 18%, transparent);
}
.picker-sv:focus-visible,
.picker-hue:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.picker-hue {
  position: relative;
  height: 12px;
  border-radius: 6px;
  cursor: pointer;
  touch-action: none;
  background: linear-gradient(
    to right,
    #ff0000 0%,
    #ffff00 17%,
    #00ff00 33%,
    #00ffff 50%,
    #0000ff 67%,
    #ff00ff 83%,
    #ff0000 100%
  );
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-ink) 18%, transparent);
}

/** 取值指示点:白环 + 一层随主题墨色的外圈,在任意底色上都看得清。
    圆形就是它的形状(直径 12px),不是为了“浑圆”而浑圆 */
.picker-dot {
  position: absolute;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 50%; /* deslop-ignore 19 */
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-ink) 40%, transparent);
  pointer-events: none;
  transition:
    left var(--duration-fast) linear,
    top var(--duration-fast) linear;
}
.picker-dot-hue {
  top: 50%;
}
/* 拖动中指示点必须紧贴指针:去掉过渡(过渡会让它落在指针后面) */
.picker-sv.is-dragging .picker-dot,
.picker-hue.is-dragging .picker-dot {
  transition: none;
}

.picker-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.picker-swatch {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-ink) 22%, transparent);
}
.picker-hex {
  flex: 1;
  min-width: 0;
  height: 28px;
  text-transform: lowercase;
}

/* 非线性进入(无过冲:非动量交互不加弹性),利落的退出;进出同路径 */
.picker-pop-enter-active {
  transition:
    opacity 180ms var(--ease-plain),
    transform var(--duration-slow) var(--ease-plain);
}
.picker-pop-leave-active {
  transition:
    opacity 120ms var(--ease-plain-inverse),
    transform 120ms var(--ease-plain-inverse);
}
.picker-pop-enter-from,
.picker-pop-leave-to {
  opacity: 0;
  transform: scale(0.94);
}
@media (prefers-reduced-motion: reduce) {
  .picker-pop-enter-active,
  .picker-pop-leave-active {
    transition: opacity 80ms linear;
  }
  .picker-pop-enter-from,
  .picker-pop-leave-to {
    transform: none;
  }
  .picker-dot {
    transition: none;
  }
}
</style>
