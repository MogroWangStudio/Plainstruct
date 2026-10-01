<script setup lang="ts">
/** 自定义日期时间选择器(精确到秒)—— 替代原生 type="date"/"datetime-local":
 *  面板为月历 + 时/分/秒输入,样式与应用统一,无系统控件的原生外观 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  /** "YYYY-MM-DD HH:mm:ss";也接受旧的纯日期写法,输出统一带时间 */
  modelValue: string;
  placeholder?: string;
}>();

const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();

const { t } = useI18n();

const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const pos = ref<{ left: string; top: string }>({ left: "0", top: "0" });

/** 当前编辑的完整时间(parts);未选择过时为 null */
const parts = ref<{ y: number; m: number; d: number; h: number; mi: number; s: number } | null>(null);
/** 月历正在展示的年月(m 为 1–12) */
const view = ref({ y: 2000, m: 1 });

const WEEK_LABELS = computed(() => [
  t("dt.weekMon"),
  t("dt.weekTue"),
  t("dt.weekWed"),
  t("dt.weekThu"),
  t("dt.weekFri"),
  t("dt.weekSat"),
  t("dt.weekSun"),
]);

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fromValue(v: string) {
  const m = v.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (m) {
    parts.value = {
      y: +m[1],
      m: +m[2],
      d: +m[3],
      h: m[4] !== undefined ? +m[4] : 0,
      mi: m[5] !== undefined ? +m[5] : 0,
      s: m[6] !== undefined ? +m[6] : 0,
    };
  } else {
    const now = new Date();
    parts.value = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(), h: 0, mi: 0, s: 0 };
  }
  view.value = { y: parts.value.y, m: parts.value.m };
}

watch(
  () => props.modelValue,
  () => {
    if (open.value) fromValue(props.modelValue);
  },
);

const display = computed(() => {
  const p = props.modelValue.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (!p) return "";
  return `${p[1]}-${pad(+p[2])}-${pad(+p[3])} ${pad(+(p[4] ?? 0))}:${pad(+(p[5] ?? 0))}:${pad(+(p[6] ?? 0))}`;
});

function emitValue() {
  const p = parts.value;
  if (!p) return;
  emit("update:modelValue", `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`);
}

/* ---------- 月历 ---------- */

interface Cell {
  day: number;
  inMonth: boolean;
  selected: boolean;
  today: boolean;
}

const cells = computed<Cell[]>(() => {
  const { y, m } = view.value;
  const first = new Date(y, m - 1, 1);
  // 周一为一周之首
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(y, m - 1, 1 - lead);
  const today = new Date();
  const sel = parts.value;
  const out: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const inMonth = d.getMonth() + 1 === m && d.getFullYear() === y;
    out.push({
      day: d.getDate(),
      inMonth,
      selected: !!sel && sel.y === d.getFullYear() && sel.m === d.getMonth() + 1 && sel.d === d.getDate(),
      today: d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate(),
    });
  }
  return out;
});

const monthLabel = computed(() => `${view.value.y} ${t("dt.monthN", { n: view.value.m })}`);

function shiftMonth(delta: number) {
  let { y, m } = view.value;
  m += delta;
  while (m < 1) (m += 12), y--;
  while (m > 12) (m -= 12), y++;
  view.value = { y, m };
}

function pickDay(cell: Cell) {
  if (!parts.value) fromValue("");
  parts.value = { ...parts.value!, y: view.value.y, m: view.value.m, d: cell.day };
  emitValue();
}

/* ---------- 时/分/秒 ---------- */

const hText = computed({
  get: () => (parts.value ? pad(parts.value.h) : "00"),
  set: (v: string) => setPart("h", v, 23),
});
const miText = computed({
  get: () => (parts.value ? pad(parts.value.mi) : "00"),
  set: (v: string) => setPart("mi", v, 59),
});
const sText = computed({
  get: () => (parts.value ? pad(parts.value.s) : "00"),
  set: (v: string) => setPart("s", v, 59),
});

function setPart(key: "h" | "mi" | "s", raw: string, max: number) {
  if (!parts.value) fromValue(props.modelValue || "");
  const n = Math.min(max, Math.max(0, Math.floor(Number(raw.replace(/\D/g, "")) || 0)));
  parts.value = { ...parts.value!, [key]: n };
  emitValue();
}

function now() {
  const d = new Date();
  parts.value = {
    y: d.getFullYear(),
    m: d.getMonth() + 1,
    d: d.getDate(),
    h: d.getHours(),
    mi: d.getMinutes(),
    s: d.getSeconds(),
  };
  view.value = { y: parts.value.y, m: parts.value.m };
  emitValue();
}

function clear() {
  parts.value = null;
  emit("update:modelValue", "");
  open.value = false;
}

/* ---------- 开合与定位 ---------- */

function place() {
  const el = trigger.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const H = 336;
  const flipUp = r.bottom + 6 + H > window.innerHeight - 8 && r.top - 6 - H > 0;
  pos.value = {
    left: `${r.left}px`,
    top: flipUp ? `${r.top - 6 - H}px` : `${r.bottom + 6}px`,
  };
}

function toggle() {
  if (open.value) {
    open.value = false;
    return;
  }
  fromValue(props.modelValue || "");
  place();
  open.value = true;
}

function onDocPointer(e: PointerEvent) {
  if (open.value && trigger.value && panelEl.value && !trigger.value.contains(e.target as Node) && !panelEl.value.contains(e.target as Node)) {
    open.value = false;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) {
    e.stopPropagation();
    open.value = false;
    trigger.value?.focus();
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointer, true);
  window.addEventListener("scroll", closeIfOpen, true);
  window.addEventListener("resize", closeIfOpen);
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointer, true);
  window.removeEventListener("scroll", closeIfOpen, true);
  window.removeEventListener("resize", closeIfOpen);
  window.removeEventListener("keydown", onKeydown);
});

function closeIfOpen() {
  if (open.value) open.value = false;
}

defineExpose({ focus: () => nextTick(() => trigger.value?.focus()) });
</script>

<template>
  <button ref="trigger" type="button" class="dt-trigger" :class="{ open }" @click="toggle">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 6h16v14H4z" />
      <path d="M4 10h16" />
      <path d="M8 4v4" />
      <path d="M16 4v4" />
    </svg>
    <span class="dt-value" :class="{ empty: !display }">{{ display || placeholder || t("dt.placeholder") }}</span>
    <span v-if="display" class="dt-clear" role="button" :aria-label="t('common.delete')" @click.stop="clear">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </span>
  </button>

  <Teleport to="body">
    <Transition name="dt-pop">
      <div v-if="open" ref="panelEl" class="dt-panel" :style="pos" role="dialog" :aria-label="t('dt.placeholder')">
        <header class="dt-head">
          <button type="button" class="dt-nav" :aria-label="t('dt.prevMonth')" @click="shiftMonth(-1)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <span class="dt-month mono">{{ monthLabel }}</span>
          <button type="button" class="dt-nav" :aria-label="t('dt.nextMonth')" @click="shiftMonth(1)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </header>

        <div class="dt-grid" role="grid">
          <span v-for="w in WEEK_LABELS" :key="w" class="dt-week">{{ w }}</span>
          <button
            v-for="(c, i) in cells"
            :key="i"
            type="button"
            class="dt-day"
            :class="{ out: !c.inMonth, selected: c.selected, today: c.today && !c.selected }"
            @click="pickDay(c)"
          >
            {{ c.day }}
          </button>
        </div>

        <div class="dt-time">
          <label class="dt-part">
            <input v-model="hText" class="dt-input mono" inputmode="numeric" :aria-label="t('dt.hour')" @focus="(e) => (e.target as HTMLInputElement).select()" />
            <span>{{ t("dt.hour") }}</span>
          </label>
          <span class="dt-colon">:</span>
          <label class="dt-part">
            <input v-model="miText" class="dt-input mono" inputmode="numeric" :aria-label="t('dt.minute')" @focus="(e) => (e.target as HTMLInputElement).select()" />
            <span>{{ t("dt.minute") }}</span>
          </label>
          <span class="dt-colon">:</span>
          <label class="dt-part">
            <input v-model="sText" class="dt-input mono" inputmode="numeric" :aria-label="t('dt.second')" @focus="(e) => (e.target as HTMLInputElement).select()" />
            <span>{{ t("dt.second") }}</span>
          </label>
        </div>

        <footer class="dt-foot">
          <button type="button" class="dt-now" @click="now">{{ t("dt.now") }}</button>
          <button type="button" class="dt-ok" @click="open = false">{{ t("common.confirm") }}</button>
        </footer>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dt-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-ink);
  font-size: calc(13px * var(--ui-font-scale));
  cursor: pointer;
  transition:
    border-color var(--duration-base) var(--ease-plain),
    background-color var(--duration-base) var(--ease-plain);
}
.dt-trigger:hover,
.dt-trigger.open {
  border-color: var(--color-line-strong);
}
.dt-trigger:focus-visible {
  outline: none;
  border-color: var(--color-line-strong);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}
.dt-trigger > svg {
  flex-shrink: 0;
  color: var(--color-ink-3);
}
.dt-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-variant-numeric: tabular-nums;
}
.dt-value.empty {
  color: var(--color-ink-3);
}
.dt-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 4px;
  color: var(--color-ink-3);
}
.dt-clear:hover {
  background: var(--color-surface-2);
  color: var(--color-ink);
}
</style>

<style>
/* 面板传送至 body,样式不随宿主 scoped */
.dt-panel {
  position: fixed;
  z-index: 95;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 264px;
  padding: 10px;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: var(--shadow-popover);
}
.dt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.dt-month {
  font-size: calc(12.5px * var(--ui-font-scale));
  color: var(--color-ink);
}
.dt-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-ink-3);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-plain),
    color var(--duration-fast) var(--ease-plain);
}
.dt-nav:hover {
  background: var(--color-surface-2);
  color: var(--color-ink);
}
.dt-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
}
.dt-week {
  padding: 2px 0 4px;
  color: var(--color-ink-3);
  font-size: calc(10.5px * var(--ui-font-scale));
  text-align: center;
}
.dt-day {
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-ink-2);
  font-size: calc(12px * var(--ui-font-scale));
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-plain),
    color var(--duration-fast) var(--ease-plain);
}
.dt-day:hover {
  background: var(--color-surface-2);
  color: var(--color-ink);
}
.dt-day.out {
  color: var(--color-ink-3);
  opacity: 0.55;
}
.dt-day.today {
  box-shadow: inset 0 0 0 1px var(--color-line-strong);
}
.dt-day.selected {
  background: var(--color-accent);
  color: var(--color-on-accent);
}
.dt-time {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 0;
  border-top: 1px solid var(--color-line);
}
.dt-part {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}
.dt-input {
  width: 40px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-ink);
  font-size: calc(12.5px * var(--ui-font-scale));
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.dt-input:focus {
  outline: none;
  border-color: var(--color-line-strong);
  box-shadow: 0 0 0 2px var(--color-accent-soft);
}
.dt-part span {
  color: var(--color-ink-3);
  font-size: calc(10px * var(--ui-font-scale));
}
.dt-colon {
  align-self: center;
  padding-top: 12px;
  color: var(--color-ink-3);
}
.dt-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dt-now,
.dt-ok {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: transparent;
  color: var(--color-ink-2);
  font-size: calc(11.5px * var(--ui-font-scale));
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-plain),
    color var(--duration-fast) var(--ease-plain);
}
.dt-now:hover {
  background: var(--color-surface-2);
  color: var(--color-ink);
}
.dt-ok {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-on-accent);
}
.dt-ok:hover {
  background: var(--color-accent-strong);
}

.dt-pop-enter-active {
  transition:
    opacity 160ms var(--ease-plain),
    transform 160ms var(--ease-plain);
}
.dt-pop-leave-active {
  transition:
    opacity 100ms var(--ease-plain-inverse),
    transform 100ms var(--ease-plain-inverse);
}
.dt-pop-enter-from,
.dt-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
@media (prefers-reduced-motion: reduce) {
  .dt-pop-enter-active,
  .dt-pop-leave-active {
    transition: opacity 80ms linear;
  }
  .dt-pop-enter-from,
  .dt-pop-leave-to {
    transform: none;
  }
}
</style>
