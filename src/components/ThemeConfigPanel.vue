<script setup lang="ts">
/** 主题可视化配置面板 -- 由 theme.json 的 config schema 自动生成表单 */
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ThemeField } from "@/ipc/types";
import { navMaxOf, topNavItems } from "@/lib/builder";
import { useSiteStore } from "@/stores/site";
import { useThemeStore } from "@/stores/theme";
import Modal from "@/components/Modal.vue";
import SelectMenu from "@/components/SelectMenu.vue";
import AppIcon from "@/components/AppIcon.vue";

const { t } = useI18n();
const theme = useThemeStore();
const site = useSiteStore();

function onField(field: ThemeField, value: string | number | boolean) {
  void theme.setConfigValue(field.key, value);
}

function fieldValue(field: ThemeField): string | number | boolean {
  return theme.configValues[field.key] ?? field.default ?? "";
}

/** visibleIf:仅当依赖字段(含默认值兜底)命中 equals 或 oneOf 时渲染该字段 */
function isVisible(field: ThemeField): boolean {
  const cond = field.visibleIf;
  if (!cond) return true;
  const dep = theme.activeMeta?.config.find((f) => f.key === cond.key);
  if (!dep) return true;
  const current = String(fieldValue(dep));
  if (cond.oneOf) return cond.oneOf.some((v) => String(v) === current);
  return current === String(cond.equals);
}

/** 数值滑块的进度填充比例(0–100%),驱动自绘轨道的已填充段 */
function rangeFill(field: ThemeField): string {
  const min = field.min ?? 0;
  const max = field.max ?? 100;
  if (max <= min) return "100%";
  const pct = ((Number(fieldValue(field)) - min) / (max - min)) * 100;
  return `${Math.min(100, Math.max(0, pct))}%`;
}

/* 数值双击编辑:直接键入精确值(回车/失焦提交,Esc 取消,越界收敛到滑块范围) */
const editingKey = ref<string | null>(null);
const editInput = ref<HTMLInputElement | null>(null);

watch(editingKey, async (k) => {
  if (!k) return;
  await nextTick();
  editInput.value?.focus();
  editInput.value?.select();
});

function commitEdit(field: ThemeField, e: Event) {
  const raw = (e.target as HTMLInputElement).value.trim();
  editingKey.value = null;
  const n = Number(raw);
  if (raw === "" || !Number.isFinite(n)) return;
  onField(field, Math.min(field.max ?? 100, Math.max(field.min ?? 0, n)));
}

/* navlist(博客顶栏导航):可选项与构建同源 -- 内容树顶层的文章/文件夹(按文件树排序) */
const navOptions = computed(() => topNavItems(site.tree, site.docsCache));

function pickedOf(field: ThemeField): string[] {
  return String(fieldValue(field) ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 数量上限与构建同源(navMaxItems 配置,缺省 6) */
const maxNav = computed(() => navMaxOf(theme.configValues));

/** 已选项的显示名(顺序与导航一致;文档已删除的项不再展示) */
function pickedLabels(field: ThemeField): string[] {
  const byKey = new Map(navOptions.value.map((o) => [o.key, o]));
  return pickedOf(field)
    .map((key) => byKey.get(key))
    .filter((o) => o !== undefined)
    .map((o) => (o.dir ? `${o.title} /` : o.title));
}

/* 弹窗选择器:草稿集,点击确认才写入配置 */
const pickerOpen = ref(false);
const pickerField = ref<ThemeField | null>(null);
const draft = ref(new Set<string>());

function openPicker(field: ThemeField) {
  pickerField.value = field;
  draft.value = new Set(pickedOf(field));
  pickerOpen.value = true;
}

const draftFull = computed(() => draft.value.size >= maxNav.value);

function toggleDraft(key: string, on: boolean) {
  const next = new Set(draft.value);
  if (on) next.add(key);
  else next.delete(key);
  draft.value = next;
}

function confirmPicker() {
  if (pickerField.value) onField(pickerField.value, [...draft.value].join("\n"));
  pickerOpen.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div v-for="field in theme.activeMeta?.config ?? []" :key="field.key" v-show="isVisible(field)" class="flex flex-col">
      <!-- 开关自带行内标签,不再重复渲染标题 -->
      <label v-if="field.type !== 'boolean'" class="field-label">{{ field.label }}</label>

      <!-- 颜色 -->
      <div v-if="field.type === 'color'" class="flex items-center gap-2">
        <input
          type="color"
          class="color-input"
          :value="String(fieldValue(field))"
          @input="onField(field, ($event.target as HTMLInputElement).value)"
        />
        <span class="mono text-[calc(12px*var(--ui-font-scale))] text-ink-2">{{ fieldValue(field) }}</span>
      </div>

      <!-- 数值:拖动滑块;双击数字可直接输入;偏离默认值时出现一键重置 -->
      <div v-else-if="field.type === 'number'" class="flex items-center gap-3">
        <input
          type="range"
          class="range-input min-w-0 flex-1"
          :min="field.min ?? 0"
          :max="field.max ?? 100"
          :step="field.step ?? 1"
          :value="Number(fieldValue(field))"
          :style="{ '--range-fill': rangeFill(field) }"
          @input="onField(field, Number(($event.target as HTMLInputElement).value))"
        />
        <input
          v-if="editingKey === field.key"
          ref="editInput"
          class="input h-7 w-14 px-1 text-center text-[calc(12px*var(--ui-font-scale))]"
          type="text"
          inputmode="decimal"
          :value="String(fieldValue(field))"
          @keydown.enter="commitEdit(field, $event)"
          @keydown.esc="editingKey = null"
          @blur="commitEdit(field, $event)"
        />
        <button
          v-else
          type="button"
          class="mono w-14 cursor-text rounded text-center text-[calc(12px*var(--ui-font-scale))] text-ink-2 transition-colors hover:text-ink"
          :title="t('theme.numEditHint')"
          @dblclick="editingKey = field.key"
        >
          {{ fieldValue(field) }}
        </button>
        <button
          v-if="Number(fieldValue(field)) !== Number(field.default ?? 0)"
          type="button"
          class="btn-icon h-6 w-6 shrink-0"
          :title="t('theme.resetValue')"
          @click="onField(field, Number(field.default ?? 0))"
        >
          <AppIcon name="refresh" :size="12" />
        </button>
      </div>

      <!-- 选项:与全应用统一的自定义下拉(无系统原生黑边选中态) -->
      <SelectMenu
        v-else-if="field.type === 'select'"
        :model-value="String(fieldValue(field))"
        :options="(field.options ?? []).map((o) => ({ value: o, label: o }))"
        align="right"
        class="shrink-0"
        @update:model-value="(v: string) => onField(field, v)"
      />

      <!-- 博客顶栏导航:按钮弹出选择窗口,确认后面板列出当前在导航中显示的项 -->
      <div v-else-if="field.type === 'navlist'" class="flex flex-col gap-2">
        <p v-if="!navOptions.length" class="text-[calc(13px*var(--ui-font-scale))] text-ink-3">{{ t("theme.navlistEmpty") }}</p>
        <template v-else>
          <button type="button" class="select !w-64 cursor-pointer text-left" @click="openPicker(field)">
            {{ pickedOf(field).length ? t("theme.navPickedCount", { n: pickedOf(field).length }) : t("theme.navPickEmpty") }}
          </button>
          <template v-if="pickedLabels(field).length">
            <p class="text-[calc(12px*var(--ui-font-scale))] text-ink-3">{{ t("theme.navPickedHeading") }}</p>
            <ul class="flex flex-col">
              <li
                v-for="(label, i) in pickedLabels(field)"
                :key="i"
                class="max-w-64 truncate py-0.5 text-[calc(13px*var(--ui-font-scale))] text-ink-2"
                :title="label"
              >
                {{ label }}
              </li>
            </ul>
          </template>
        </template>
      </div>

      <!-- 开关 -->
      <label v-else-if="field.type === 'boolean'" class="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          class="checkbox-input"
          :checked="Boolean(fieldValue(field))"
          @change="onField(field, ($event.target as HTMLInputElement).checked)"
        />
        <span class="text-[calc(13px*var(--ui-font-scale))] text-ink-2">{{ field.label }}</span>
      </label>

      <!-- 文本 -->
      <input
        v-else
        class="input !w-64"
        type="text"
        :value="String(fieldValue(field))"
        @change="onField(field, ($event.target as HTMLInputElement).value)"
      />
    </div>

    <p v-if="!(theme.activeMeta?.config ?? []).length" class="text-[calc(13px*var(--ui-font-scale))] text-ink-3">
      {{ t("common.empty") }}
    </p>

    <!-- 顶栏导航选择弹窗:勾选数量上限内的项,确认后才写入配置 -->
    <Modal v-if="pickerOpen" :title="t('theme.navPickTitle')" :width="420" @cancel="pickerOpen = false">
      <div class="flex min-h-[420px] flex-col">
        <label
          v-for="opt in navOptions"
          :key="opt.key"
          class="navlist-row"
          :class="{ off: draftFull && !draft.has(opt.key) }"
        >
          <input
            type="checkbox"
            class="checkbox-input"
            :checked="draft.has(opt.key)"
            :disabled="draftFull && !draft.has(opt.key)"
            @change="toggleDraft(opt.key, ($event.target as HTMLInputElement).checked)"
          />
          <span class="min-w-0 truncate text-[calc(13px*var(--ui-font-scale))] text-ink-2">{{ opt.title }}{{ opt.dir ? " /" : "" }}</span>
        </label>
      </div>
      <p v-if="draftFull" class="mt-1 text-[calc(12px*var(--ui-font-scale))] text-ink-3">{{ t("theme.navlistMax", { n: maxNav }) }}</p>
      <template #footer>
        <button class="btn btn-secondary" @click="pickerOpen = false">{{ t("common.cancel") }}</button>
        <button class="btn btn-primary" @click="confirmPicker">{{ t("common.confirm") }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.color-input {
  width: 32px;
  height: 32px;
  padding: 2px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  cursor: pointer;
}
.color-input::-webkit-color-swatch-wrapper {
  padding: 0;
}
.color-input::-webkit-color-swatch {
  border: none;
  border-radius: 5px;
}

.navlist-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  cursor: pointer;
  transition: opacity var(--duration-base) var(--ease-plain);
}
.navlist-row.off {
  opacity: 0.4;
  cursor: default;
}
</style>
