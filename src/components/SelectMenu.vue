<script setup lang="ts">
/** 自定义下拉选择 -- 面板以带轻微过冲的非线性缓动弹出;选项无系统黑边框选中态 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { toCssPx, uiZoom } from "@/lib/scale";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: { value: string; label: string; group?: string }[];
    /** 面板对齐方向 */
    align?: "left" | "right";
  }>(),
  { align: "right" },
);

const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();

/** 选项分组:任一选项带 group 时按连续分组渲染弱化小标题,否则单组平铺(无标题);
 *  标题仅作视觉分隔,不是选项,不参与键盘导航与选择 */
const grouped = computed(() => {
  if (!props.options.some((o) => o.group)) return [{ label: "", options: props.options }];
  const out: { label: string; options: { value: string; label: string; group?: string }[] }[] = [];
  for (const opt of props.options) {
    const label = opt.group ?? "";
    const last = out[out.length - 1];
    if (last && last.label === label) last.options.push(opt);
    else out.push({ label, options: [opt] });
  }
  return out;
});

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const open = ref(false);
const flipUp = ref(false);
/** 固定定位的面板坐标(传送出滚动容器,避免被裁剪) */
const pos = ref<{ top?: string; bottom?: string; left: string; minWidth: string }>({
  left: "0",
  minWidth: "0",
});
const listEl = ref<HTMLElement | null>(null);

const current = () => props.options.find((o) => o.value === props.modelValue);

function placePanel() {
  const t = trigger.value;
  if (!t) return;
  const r = t.getBoundingClientRect();
  const headers = grouped.value.filter((g) => g.label).length;
  const estimatedH = props.options.length * 34 + headers * 22 + 10;
  // 界面缩放(zoom)下:rect/视口比较在视觉像素中进行,面板 CSS 定位值经 toCssPx 还原
  const z = uiZoom();
  flipUp.value = r.bottom + 6 + estimatedH * z > window.innerHeight - 8;
  pos.value = {
    left: toCssPx(props.align === "right" ? r.right : r.left) + "px",
    minWidth: toCssPx(Math.max(r.width, 150)) + "px",
    ...(flipUp.value
      ? { bottom: toCssPx(window.innerHeight - r.top + 6) + "px" }
      : { top: toCssPx(r.bottom + 6) + "px" }),
  };
}

async function toggle() {
  if (open.value) {
    open.value = false;
    return;
  }
  placePanel();
  open.value = true;
  await nextTick();
  // 打开即聚焦当前选项,键盘方向键即可在选项间移动
  const init = listEl.value?.querySelector<HTMLButtonElement>(".select-option.selected");
  (init ?? listEl.value?.querySelector<HTMLButtonElement>(".select-option"))?.focus();
}

function choose(v: string) {
  emit("update:modelValue", v);
  open.value = false;
  trigger.value?.focus();
}

function close() {
  open.value = false;
}

function onDocPointer(e: PointerEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) close();
}

/** 滚动收起:只对外部容器滚动生效。面板自身滚动不收起 —— 选中项在面板可视区
 *  之外时,打开菜单聚焦它会自动滚动面板;选项列表超高后滚动手势也在面板内,
 *  这两种滚动若触发收起,菜单就会在打开的瞬间或使用中直接消失 */
function onDocScroll(e: Event) {
  if (listEl.value && e.target instanceof Node && listEl.value.contains(e.target)) return;
  close();
}

function onPanelKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.stopPropagation();
    close();
    trigger.value?.focus();
    return;
  }
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const items = [...(listEl.value?.querySelectorAll<HTMLButtonElement>(".select-option") ?? [])];
  if (!items.length) return;
  const idx = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
  items[next]?.focus();
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointer, true);
  // 滚动/改变尺寸时收起,避免面板与触发器脱节(面板内部滚动除外,见 onDocScroll)
  window.addEventListener("scroll", onDocScroll, true);
  window.addEventListener("resize", close);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointer, true);
  window.removeEventListener("scroll", onDocScroll, true);
  window.removeEventListener("resize", close);
});
</script>

<template>
  <div ref="root" class="select-menu">
    <button
      ref="trigger"
      type="button"
      class="select-trigger"
      :aria-expanded="open"
      :aria-haspopup="'listbox'"
      @click="toggle"
      @keydown.down.prevent="!open && toggle()"
      @keydown.up.prevent="!open && toggle()"
    >
      <span class="select-value">{{ current()?.label ?? modelValue }}</span>
      <svg
        class="select-caret"
        :class="{ open }"
        width="11"
        height="11"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M2.5 4.5 6 8l3.5-3.5" />
      </svg>
    </button>

    <Teleport to="body">
      <Transition name="select-pop">
        <div
          v-if="open"
          ref="listEl"
          class="select-panel"
          :style="{ ...pos, transformOrigin: flipUp ? 'bottom right' : 'top right' }"
          role="listbox"
          @keydown="onPanelKeydown"
        >
          <template v-for="(grp, gi) in grouped" :key="gi">
            <div v-if="grp.label" class="select-group" role="presentation">{{ grp.label }}</div>
            <button
              v-for="opt in grp.options"
              :key="opt.value"
              type="button"
              role="option"
              class="select-option"
              :class="{ selected: opt.value === modelValue }"
              :aria-selected="opt.value === modelValue"
              @click="choose(opt.value)"
            >
              <span>{{ opt.label }}</span>
              <svg
                v-if="opt.value === modelValue"
                width="13"
                height="13"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M2.5 7.5 5.5 10.5 11.5 3.5" />
              </svg>
            </button>
          </template>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.select-menu {
  position: relative;
  display: inline-block;
}

/* 触发器:不使用系统 select,也就没有黑色描边的选中/焦点效果 */
.select-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 32px;
  min-width: 132px;
  padding: 0 10px 0 12px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md, 8px);
  background: var(--color-bg);
  color: var(--color-ink);
  font-size: calc(13px * var(--ui-font-scale));
  cursor: pointer;
  transition:
    border-color var(--duration-base) var(--ease-plain),
    background-color var(--duration-base) var(--ease-plain);
}
.select-trigger:hover {
  border-color: var(--color-line-strong);
  background: var(--color-surface);
}
.select-trigger:focus-visible {
  outline: none;
  border-color: var(--color-line-strong);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}
.select-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.select-caret {
  flex-shrink: 0;
  color: var(--color-ink-3);
  transition: transform var(--duration-slow) var(--ease-plain);
}
.select-caret.open {
  transform: rotate(180deg);
}
</style>

<style>
/* 面板传送至 body,样式不随宿主 scoped */
.select-panel {
  position: fixed;
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: min(320px, 60vh);
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: var(--shadow-popover);
}
.select-group {
  padding: 6px 10px 2px;
  font-size: calc(11px * var(--ui-font-scale));
  color: var(--color-ink-3);
  user-select: none;
}
.select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-ink-2);
  font-size: calc(13px * var(--ui-font-scale));
  text-align: left;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-plain);
}
.select-option:hover,
.select-option:focus-visible {
  outline: none;
  background: var(--color-surface-2);
  color: var(--color-ink);
}
.select-option.selected {
  background: var(--color-accent-soft);
  color: var(--color-ink);
  font-weight: 500;
}
.select-option.selected svg {
  color: var(--color-ink-2);
}

/* 非线性进入(无过冲,非动量交互不加弹性),利落的退出 */
.select-pop-enter-active {
  transition:
    opacity 180ms var(--ease-plain),
    transform var(--duration-slow) var(--ease-plain);
}
.select-pop-leave-active {
  transition:
    opacity 120ms var(--ease-plain-inverse),
    transform 120ms var(--ease-plain-inverse);
}
.select-pop-enter-from {
  opacity: 0;
  transform: translateY(-6px) scale(0.92);
}
.select-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}
@media (prefers-reduced-motion: reduce) {
  .select-pop-enter-active,
  .select-pop-leave-active {
    transition: opacity 80ms linear;
  }
  .select-pop-enter-from,
  .select-pop-leave-to {
    transform: none;
  }
}
</style>
