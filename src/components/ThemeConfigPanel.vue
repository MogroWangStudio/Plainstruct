<script setup lang="ts">
/** 主题可视化配置面板 -- 由 theme.json 的 config schema 自动生成表单 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ThemeField } from "@/ipc/types";
import { navMaxOf, topNavItems } from "@/lib/builder";
import { useSiteStore } from "@/stores/site";
import { useThemeStore } from "@/stores/theme";

const { t } = useI18n();
const theme = useThemeStore();
const site = useSiteStore();

function onField(field: ThemeField, value: string | number | boolean) {
  void theme.setConfigValue(field.key, value);
}

function fieldValue(field: ThemeField): string | number | boolean {
  return theme.configValues[field.key] ?? field.default ?? "";
}

/** visibleIf:仅当依赖字段(含默认值兜底)等于指定值时渲染该字段 */
function isVisible(field: ThemeField): boolean {
  const cond = field.visibleIf;
  if (!cond) return true;
  const dep = theme.activeMeta?.config.find((f) => f.key === cond.key);
  if (!dep) return true;
  return String(fieldValue(dep)) === String(cond.equals);
}

/* navlist(博客顶栏导航):可选项与构建同源 -- 内容树顶层的文章/文件夹 */
const navOptions = computed(() => topNavItems(site.tree, site.docsCache));

function pickedOf(field: ThemeField): string[] {
  return String(fieldValue(field) ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 数量上限与构建同源(navMaxItems 配置,缺省 6) */
const maxNav = computed(() => navMaxOf(theme.configValues));

function maxReached(field: ThemeField): boolean {
  return pickedOf(field).length >= maxNav.value;
}

function isChecked(field: ThemeField, key: string): boolean {
  return pickedOf(field).includes(key);
}

/** 上限已满且该项未勾选时锁住,防止顶栏被挤满 */
function isNavLocked(field: ThemeField, key: string): boolean {
  return maxReached(field) && !isChecked(field, key);
}

function toggleNav(field: ThemeField, key: string, on: boolean) {
  const picked = new Set(pickedOf(field));
  if (on) picked.add(key);
  else picked.delete(key);
  onField(field, [...picked].join("\n"));
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
        <span class="mono text-[12px] text-ink-2">{{ fieldValue(field) }}</span>
      </div>

      <!-- 数值 -->
      <div v-else-if="field.type === 'number'" class="flex items-center gap-3">
        <input
          type="range"
          class="range-input"
          :min="field.min ?? 0"
          :max="field.max ?? 100"
          :step="field.step ?? 1"
          :value="Number(fieldValue(field))"
          @input="onField(field, Number(($event.target as HTMLInputElement).value))"
        />
        <span class="mono w-12 text-right text-[12px] text-ink-2">{{ fieldValue(field) }}</span>
      </div>

      <!-- 选项 -->
      <select
        v-else-if="field.type === 'select'"
        class="select !w-48"
        :value="String(fieldValue(field))"
        @change="onField(field, ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="opt in field.options ?? []" :key="opt" :value="opt">{{ opt }}</option>
      </select>

      <!-- 博客顶栏导航:勾选即显示(顺序随内容树),达到数量上限后其余项禁用 -->
      <div v-else-if="field.type === 'navlist'" class="flex flex-col">
        <p v-if="!navOptions.length" class="text-[13px] text-ink-3">{{ t("theme.navlistEmpty") }}</p>
        <template v-else>
          <label
            v-for="opt in navOptions"
            :key="opt.key"
            class="navlist-row"
            :class="{ off: isNavLocked(field, opt.key) }"
          >
            <input
              type="checkbox"
              class="checkbox-input"
              :checked="isChecked(field, opt.key)"
              :disabled="isNavLocked(field, opt.key)"
              @change="toggleNav(field, opt.key, ($event.target as HTMLInputElement).checked)"
            />
            <span class="min-w-0 truncate text-[13px] text-ink-2">{{ opt.title }}{{ opt.dir ? " /" : "" }}</span>
          </label>
          <p v-if="maxReached(field)" class="mt-1 text-[12px] text-ink-3">
            {{ t("theme.navlistMax", { n: maxNav }) }}
          </p>
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
        <span class="text-[13px] text-ink-2">{{ field.label }}</span>
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

    <p v-if="!(theme.activeMeta?.config ?? []).length" class="text-[13px] text-ink-3">
      {{ t("common.empty") }}
    </p>
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

.range-input {
  width: 192px;
  accent-color: var(--color-accent);
}

.checkbox-input {
  width: 15px;
  height: 15px;
  accent-color: var(--color-accent);
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
