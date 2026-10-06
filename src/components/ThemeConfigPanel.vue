<script setup lang="ts">
/** 主题可视化配置面板 -- 由 theme.json 的 config schema 自动生成表单;
 *  末尾追加站点级「插件」分组(内置搜索/图片预览开关 + 用户导入的插件),对所有主题生效 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ThemeField } from "@/ipc/types";
import { navMaxOf, topNavItems, type NavPickerItem } from "@/lib/builder";
import { normalizePlugins } from "@/lib/plugins";
import { useSiteStore } from "@/stores/site";
import { useThemeStore } from "@/stores/theme";
import { useUiStore } from "@/stores/ui";
import Modal from "@/components/Modal.vue";
import SelectMenu from "@/components/SelectMenu.vue";
import ColorPicker from "@/components/ColorPicker.vue";
import AppIcon from "@/components/AppIcon.vue";

const { t } = useI18n();
const theme = useThemeStore();
const site = useSiteStore();
const ui = useUiStore();

function onField(field: ThemeField, value: string | number | boolean) {
  void theme.setConfigValue(field.key, value);
}

function fieldValue(field: ThemeField): string | number | boolean {
  return theme.configValues[field.key] ?? field.default ?? "";
}

/* ---------- 配置分组(theme.json 的 category;无分类的旧主题保持平铺) ---------- */

interface Section {
  id: string;
  label: string;
  fields: ThemeField[];
}

/** 站点插件分组(固定追加在所有主题配置之后,不属于任何 theme.json schema) */
const PLUGINS_ID = "theme-cat-plugins";

/** 全部分组(按 theme.json 中的出现顺序);字段没有分类时归入「其他」;插件分组始终尾随 */
const sections = computed<Section[]>(() => {
  const fields = theme.activeMeta?.config ?? [];
  const pluginSection: Section = { id: PLUGINS_ID, label: t("theme.pluginsCategory"), fields: [] };
  if (!fields.some((f) => f.category)) return [pluginSection];
  const order: string[] = [];
  const groups = new Map<string, ThemeField[]>();
  for (const f of fields) {
    const label = f.category ?? t("theme.otherCategory");
    if (!groups.has(label)) {
      groups.set(label, []);
      order.push(label);
    }
    groups.get(label)!.push(f);
  }
  return [...order.map((label, i) => ({ id: `theme-cat-${i}`, label, fields: groups.get(label)! })), pluginSection];
});

/** 渲染分组:分类主题每组一个圆角边框容器;无分类的旧主题合成单个无标题组平铺 */
const groupedRows = computed<{ id?: string; label?: string; fields: ThemeField[] }[]>(() => {
  const fields = theme.activeMeta?.config ?? [];
  if (!fields.some((f) => f.category)) {
    return [
      { fields: fields.filter((f) => isVisible(f)) },
      { id: PLUGINS_ID, label: t("theme.pluginsCategory"), fields: [] },
    ];
  }
  const out: { id?: string; label?: string; fields: ThemeField[] }[] = [];
  for (const section of sections.value) {
    const groupFields = section.fields.filter((f) => isVisible(f));
    if (!groupFields.length && section.id !== PLUGINS_ID) continue;
    out.push({ id: section.id, label: section.label, fields: groupFields });
  }
  return out;
});

/** 顶部快速跳转按钮:只列当前有可见配置的分类(插件分组恒在) */
const navSections = computed(() =>
  sections.value.filter((s) => s.id === PLUGINS_ID || s.fields.some((f) => isVisible(f))),
);

/* 悬浮分类栏:圆角矩形浮层,滚动时内容从其下方穿过。分组标题的让位距离
   按栏的「实际渲染高度」动态计算 —— 分类多换行、界面字号缩放、语言切换
   都会改变高度,硬编码值必然失准;ResizeObserver 随时跟进。 */
const catNav = ref<HTMLElement>();
const catFloat = ref(0); // scroll-margin:吸附位 6px + 栏高 + 渐变模糊带 14px + 呼吸 4px
const catTop = ref(0); // sticky top:补偿滚动容器的参照系差,使视觉吸附位恒为 6px
let catNavObserver: ResizeObserver | null = null;

function measureCatNav() {
  const nav = catNav.value;
  if (!nav) return;
  // sticky 的 top 以滚动容器「内边距缘」为参照,而视觉期望从容器顶边算起:
  // 找到实际滚动容器读出 padding-top,把它从 top 里扣掉(不同主题页容器内边距不同)
  let scroller: HTMLElement | null = nav.parentElement;
  while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) scroller = scroller.parentElement;
  const padTop = scroller ? parseFloat(getComputedStyle(scroller).paddingTop) || 0 : 0;
  catTop.value = 6 - padTop;
  catFloat.value = nav.offsetHeight + 24;
}

watch(catNav, (el) => {
  catNavObserver?.disconnect();
  catNavObserver = null;
  if (!el) return;
  catNavObserver = new ResizeObserver(measureCatNav);
  catNavObserver.observe(el);
  measureCatNav();
});

onBeforeUnmount(() => {
  catNavObserver?.disconnect();
  flashAnim?.cancel();
});

/** 点击分类按钮滚动到对应分组,落点由 --cat-float 精确让位(减弱动态时直接跳位);
 *  跳转后分组标题短暂闪烁变色,提示落点位置 */
function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  flashHead(el, reduced);
}

let flashAnim: Animation | null = null;

/** 标题颜色脉冲三次(素色 → 注意色 → 素色);减弱动态时不闪,落点即时可见即足矣 */
function flashHead(el: HTMLElement, reduced: boolean) {
  if (reduced) return;
  const base = getComputedStyle(el).color;
  const attn = getComputedStyle(document.documentElement).getPropertyValue("--color-attention").trim() || "#3574f0";
  flashAnim?.cancel();
  flashAnim = el.animate(
    [
      { color: base, offset: 0 },
      { color: attn, offset: 0.12 },
      { color: base, offset: 0.3 },
      { color: attn, offset: 0.45 },
      { color: base, offset: 0.63 },
      { color: attn, offset: 0.8 },
      { color: base, offset: 1 },
    ],
    { duration: 1500, easing: "ease-in-out" },
  );
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

/* 数值双击编辑:输入框恒在数字原地(同一格位,布局零位移),双击前只读展示;
   回车/失焦提交,Esc 取消,越界收敛到滑块范围 */
const editingKey = ref<string | null>(null);
let editEl: HTMLInputElement | null = null;

/** v-for 内的函数引用:只捕获正处于编辑态的那个输入框 */
function setEditRef(key: string, el: unknown) {
  if (editingKey.value === key) editEl = (el as HTMLInputElement) ?? null;
}

watch(editingKey, async (k) => {
  await nextTick();
  if (k === null) {
    editEl = null;
    return;
  }
  editEl?.focus();
  editEl?.select();
});

function commitEdit(field: ThemeField, e: Event) {
  // 只读态点别处触发的 blur 不提交
  if (editingKey.value !== field.key) return;
  const raw = (e.target as HTMLInputElement).value.trim();
  editingKey.value = null;
  const n = Number(raw);
  if (raw === "" || !Number.isFinite(n)) return;
  onField(field, Math.min(field.max ?? 100, Math.max(field.min ?? 0, n)));
}

/** 令牌按钮:把占位符追加到文本字段当前值尾部(如构建信息格式的 {date}) */
function insertToken(field: ThemeField, token: string) {
  onField(field, String(fieldValue(field) ?? "") + token);
}

/* ---------- links 字段(友情链接等):可视化逐条编辑,存储保持「名称|链接|图标」行文本 ---------- */

interface LinkRow {
  name: string;
  url: string;
  icon: string;
}

/** 行文本 → 行对象(名称|链接|图标,图标可选) */
function parseLinks(raw: string): LinkRow[] {
  return String(raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const seg = l.split("|").map((s) => s.trim());
      return { name: seg[0] ?? "", url: seg[1] ?? "", icon: seg[2] ?? "" };
    });
}

/** 行对象 → 行文本(每行恒三段:空行 = "||" 可解析回空行;尾空段无害,构建端 split 三段兼容) */
function linksToText(rows: LinkRow[]): string {
  return rows
    .map((r) => [r.name, r.url, r.icon].join("|"))
    .join("\n");
}

function updateLink(field: ThemeField, i: number, key: keyof LinkRow, value: string) {
  const rows = parseLinks(String(fieldValue(field) ?? ""));
  if (!rows[i]) return;
  rows[i] = { ...rows[i], [key]: value };
  onField(field, linksToText(rows));
}

function addLinkRow(field: ThemeField) {
  const rows = parseLinks(String(fieldValue(field) ?? ""));
  rows.push({ name: "", url: "", icon: "" });
  onField(field, linksToText(rows));
}

function removeLinkRow(field: ThemeField, i: number) {
  const rows = parseLinks(String(fieldValue(field) ?? ""));
  rows.splice(i, 1);
  onField(field, linksToText(rows));
}

/* navlist(博客顶栏导航):可选项与构建同源 -- 完整导航树,文件夹默认折叠,点箭头展开 */
const navOptions = computed<NavPickerItem[]>(() => topNavItems(site.tree, site.docsCache));

/** 已展开的文件夹(未展开的默认折叠) */
const expandedDirs = ref(new Set<string>());

function toggleDir(key: string) {
  const next = new Set(expandedDirs.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedDirs.value = next;
}

/** 选择器的平铺展示序列(随展开状态变化),保留层级缩进与折叠箭头信息 */
const pickerRows = computed(() => {
  const rows: { opt: NavPickerItem; depth: number; hasChildren: boolean }[] = [];
  const walk = (opts: NavPickerItem[], depth: number) => {
    for (const opt of opts) {
      rows.push({ opt, depth, hasChildren: opt.children.length > 0 });
      if (opt.children.length && expandedDirs.value.has(opt.key)) walk(opt.children, depth + 1);
    }
  };
  walk(navOptions.value, 0);
  return rows;
});

/** 选择行的原始内容(htmlPath 或 htmlPath|顶栏显示名) */
function pickedOf(field: ThemeField): string[] {
  return String(fieldValue(field) ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 选择行的纯 key(剥掉 | 后的自定义名),供勾选集合比对 */
function pickedKeys(field: ThemeField): string[] {
  return pickedOf(field).map((line) => {
    const i = line.indexOf("|");
    return (i > 0 ? line.slice(0, i) : line).trim();
  });
}

/** 已选项的显示名映射(key -> 自定义顶栏名,无名称为空串) */
function pickedCustoms(field: ThemeField): Map<string, string> {
  return new Map(
    pickedOf(field).map((line) => {
      const i = line.indexOf("|");
      return i > 0 ? [line.slice(0, i).trim(), line.slice(i + 1).trim()] : [line, ""];
    }),
  );
}

/** 修改某选中项的顶栏显示名(留空 = 恢复显示页面原标题) */
function renamePicked(field: ThemeField, key: string, name: string) {
  const lines = pickedOf(field).map((line) => {
    const i = line.indexOf("|");
    const k = (i > 0 ? line.slice(0, i) : line).trim();
    if (k !== key) return line;
    return name.trim() ? `${key}|${name.trim()}` : key;
  });
  onField(field, lines.join("\n"));
}

/** 数量上限与构建同源(navMaxItems 配置,缺省 6) */
const maxNav = computed(() => navMaxOf(theme.configValues));

/** 已选行(含所在文件夹链与自定义顶栏名;文档已删除的项不再展示) */
interface PickedRow {
  key: string;
  label: string;
  custom: string;
}

function pickedRows(field: ThemeField): PickedRow[] {
  const labels = new Map<string, string>();
  const walk = (opts: NavPickerItem[], prefix: string) => {
    for (const o of opts) {
      const label = prefix ? `${prefix} / ${o.title}` : o.title;
      labels.set(o.key, label);
      if (o.children.length) walk(o.children, o.dir ? label : prefix);
    }
  };
  walk(navOptions.value, "");
  return pickedOf(field)
    .map((line) => {
      const i = line.indexOf("|");
      const key = (i > 0 ? line.slice(0, i) : line).trim();
      return { key, custom: i > 0 ? line.slice(i + 1).trim() : "" };
    })
    .filter((r) => labels.has(r.key))
    .map((r) => ({ ...r, label: labels.get(r.key)! }));
}

/* 弹窗选择器:草稿集,点击确认才写入配置 */
const pickerOpen = ref(false);
const pickerField = ref<ThemeField | null>(null);
const draft = ref(new Set<string>());

function openPicker(field: ThemeField) {
  pickerField.value = field;
  draft.value = new Set(pickedKeys(field));
  pickerOpen.value = true;
}

const draftFull = computed(() => draft.value.size >= maxNav.value);

function toggleDraft(key: string, on: boolean) {
  const next = new Set(draft.value);
  if (on) next.add(key);
  else next.delete(key);
  draft.value = next;
}

/** 确认勾选:已设过的顶栏自定义名原样保留(勾掉再勾回不丢名称) */
function confirmPicker() {
  if (!pickerField.value) return;
  const customs = pickedCustoms(pickerField.value);
  onField(
    pickerField.value,
    [...draft.value].map((key) => (customs.get(key) ? `${key}|${customs.get(key)}` : key)).join("\n"),
  );
  pickerOpen.value = false;
}

/* ---------- 站点插件:内置插件开关 + 用户导入的插件(站点级,所有主题全局生效) ---------- */

const plugins = computed(() =>
  site.config
    ? normalizePlugins(site.config)
    : {
        search: true,
        imgPreview: true,
        imgPreviewRequireMark: "mws_ps_imgpreview",
        searchStyle: "button",
        searchPosition: "bottom-right",
        searchStyleM: undefined,
        searchPositionM: undefined,
        custom: [],
      },
);

function setBuiltin(key: "search" | "imgPreview", on: boolean) {
  void site.savePlugins({ [key]: on });
}

/** 图片预览的 class 标记模式(如 mws_ps_imgpreview);留空对所有正文图片生效 */
function setImgPreviewMark(mark: string) {
  void site.savePlugins({ imgPreviewRequireMark: mark.trim() });
}

async function importPlugin() {
  const ok = await site.importPlugin();
  if (ok) ui.toast(t("theme.pluginImported"), "success");
}

async function removePlugin(id: string, name: string) {
  const ok = await ui.confirmDialog({
    title: t("theme.pluginRemoveTitle"),
    body: t("theme.pluginRemoveBody", { name }),
    danger: true,
    confirmText: t("theme.pluginRemove"),
  });
  if (ok) await site.removePlugin(id);
}
</script>

<template>
  <div class="flex flex-col gap-5" :style="catFloat ? { '--cat-float': `${catFloat}px` } : undefined">
    <!-- 分类快速跳转:悬浮圆角矩形栏,内容从其下方穿过,点击滚动到对应分组 -->
    <nav
      v-if="navSections.length"
      ref="catNav"
      class="cat-nav"
      :style="{ '--cat-top': `${catTop}px` }"
      :aria-label="t('theme.catNav')"
    >
      <button v-for="s in navSections" :key="s.id" type="button" class="cat-chip" @click="jumpTo(s.id)">
        {{ s.label }}
      </button>
    </nav>

    <!-- 分组:圆角矩形边框把每组配置框起来;无分类的旧主题合成单个无标题组 -->
    <section v-for="group in groupedRows" :key="group.id ?? '__flat__'" class="cat-group">
      <!-- 分组标题:面板顶部的分类按钮滚动到这里,跳转后短暂闪烁变色提示落点 -->
      <h3 v-if="group.id" :id="group.id" class="cat-head">{{ group.label }}</h3>

      <!-- 站点插件分组:内置插件开关 + 用户导入的插件,站点级配置,对所有主题全局生效 -->
      <template v-if="group.id === PLUGINS_ID">
        <label class="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            class="checkbox-input"
            :checked="plugins.search"
            @change="setBuiltin('search', ($event.target as HTMLInputElement).checked)"
          />
          <span class="text-[calc(13px*var(--ui-font-scale))] text-ink-2">{{ t("theme.pluginSearch") }}</span>
        </label>
        <p class="opt-hint">{{ t("theme.pluginSearchHint") }}</p>

        <label class="flex flex-col gap-1">
          <span class="field-label">{{ t("theme.pluginSearchStyle") }}</span>
          <SelectMenu
            :model-value="plugins.searchStyle"
            :options="[
              { value: 'button', label: t('theme.pluginSearchStyleButton') },
              { value: 'bar', label: t('theme.pluginSearchStyleBar') },
            ]"
            align="left"
            @update:model-value="(v: string) => site.savePlugins({ searchStyle: v as 'button' | 'bar' })"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="field-label">{{ t("theme.pluginSearchPosition") }}</span>
          <SelectMenu
            :model-value="plugins.searchPosition"
            :options="[
              { value: 'bottom-right', label: t('theme.pluginSearchPosBr') },
              { value: 'bottom-left', label: t('theme.pluginSearchPosBl') },
              { value: 'topbar', label: t('theme.pluginSearchPosTop') },
            ]"
            align="left"
            @update:model-value="(v: string) => site.savePlugins({ searchPosition: v as 'bottom-right' | 'bottom-left' | 'topbar' })"
          />
        </label>

        <!-- 移动端独立设置:缺省沿用上方 PC 配置 -->
        <label class="flex flex-col gap-1">
          <span class="field-label">{{ t("theme.pluginSearchStyleM") }}</span>
          <SelectMenu
            :model-value="plugins.searchStyleM ?? ''"
            :options="[
              { value: '', label: t('theme.pluginSearchStyle') + ' · ' + (plugins.searchStyle === 'bar' ? t('theme.pluginSearchStyleBar') : t('theme.pluginSearchStyleButton')) },
              { value: 'button', label: t('theme.pluginSearchStyleButton') },
              { value: 'bar', label: t('theme.pluginSearchStyleBar') },
            ]"
            align="left"
            @update:model-value="(v: string) => site.savePlugins({ searchStyleM: (v || undefined) as 'button' | 'bar' | undefined })"
          />
          <p class="opt-hint">{{ t("theme.pluginSearchStyleMHint") }}</p>
        </label>
        <label class="flex flex-col gap-1">
          <span class="field-label">{{ t("theme.pluginSearchPositionM") }}</span>
          <SelectMenu
            :model-value="plugins.searchPositionM ?? ''"
            :options="[
              { value: '', label: t('theme.pluginSearchPosition') + ' · ' + (plugins.searchPosition === 'bottom-right' ? t('theme.pluginSearchPosBr') : plugins.searchPosition === 'bottom-left' ? t('theme.pluginSearchPosBl') : t('theme.pluginSearchPosTop')) },
              { value: 'bottom-right', label: t('theme.pluginSearchPosBr') },
              { value: 'bottom-left', label: t('theme.pluginSearchPosBl') },
              { value: 'topbar', label: t('theme.pluginSearchPosTop') },
            ]"
            align="left"
            @update:model-value="(v: string) => site.savePlugins({ searchPositionM: (v || undefined) as 'bottom-right' | 'bottom-left' | 'topbar' | undefined })"
          />
        </label>

        <label class="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            class="checkbox-input"
            :checked="plugins.imgPreview"
            @change="setBuiltin('imgPreview', ($event.target as HTMLInputElement).checked)"
          />
          <span class="text-[calc(13px*var(--ui-font-scale))] text-ink-2">{{ t("theme.pluginImgPreview") }}</span>
        </label>
        <p class="opt-hint">{{ t("theme.pluginImgPreviewHint") }}</p>

        <!-- 图片预览的 class 标记模式:设置后仅带该 class 的图片可预览 -->
        <label class="flex flex-col gap-1">
          <span class="field-label">{{ t("theme.pluginImgPreviewMark") }}</span>
          <input
            class="input !w-64"
            type="text"
            :value="plugins.imgPreviewRequireMark"
            :placeholder="t('theme.pluginImgPreviewMarkPlaceholder')"
            @change="setImgPreviewMark(($event.target as HTMLInputElement).value)"
          />
          <p class="opt-hint">{{ t("theme.pluginImgPreviewMarkHint") }}</p>
        </label>

        <div class="flex flex-col gap-1 border-t border-line pt-3">
          <template v-if="plugins.custom.length">
            <div
              v-for="entry in plugins.custom"
              :key="entry.id"
              class="plugin-row"
              :title="entry.files.join('\n')"
            >
              <input
                type="checkbox"
                class="checkbox-input"
                :checked="entry.enabled"
                @change="site.setPluginEnabled(entry.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="min-w-0 flex-1 truncate text-[calc(13px*var(--ui-font-scale))] text-ink-2">{{ entry.name }}</span>
              <span class="shrink-0 text-[calc(11px*var(--ui-font-scale))] text-ink-3">
                {{ t("theme.pluginFileCount", { n: entry.files.length }) }}
              </span>
              <button type="button" class="btn-icon h-6 w-6 shrink-0" :title="t('theme.pluginRemove')" @click="removePlugin(entry.id, entry.name)">
                <AppIcon name="trash" :size="12" />
              </button>
            </div>
          </template>
          <p v-else class="text-[calc(13px*var(--ui-font-scale))] text-ink-3">{{ t("theme.pluginEmpty") }}</p>
        </div>

        <div>
          <button type="button" class="btn btn-secondary" @click="importPlugin">
            <AppIcon name="plus" :size="13" />
            {{ t("theme.pluginImport") }}
          </button>
        </div>
        <p class="opt-hint">{{ t("theme.pluginHint") }}</p>
      </template>

      <template v-else>
        <div v-for="field in group.fields" :key="field.key" class="flex flex-col">
        <!-- 开关自带行内标签,不再重复渲染标题 -->
        <label v-if="field.type !== 'boolean'" class="field-label">{{ field.label }}</label>

        <!-- 颜色:自定义取色器(色块 + 十六进制值,面板取色,不用系统原生控件) -->
        <ColorPicker
          v-if="field.type === 'color'"
          :model-value="String(fieldValue(field))"
          :label="field.label"
          @update:model-value="(v: string) => onField(field, v)"
        />

        <!-- 数值:拖动滑块;数字原地可编辑 —— 双击后同一格位就地进入输入态(不占整行),
             编辑态以强调色描边 + 淡色光环绕浮现,非线性缓动;偏离默认值时一键重置 -->
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
            class="num-input mono"
            :class="{ editing: editingKey === field.key }"
            type="text"
            inputmode="decimal"
            :readonly="editingKey !== field.key"
            :value="String(fieldValue(field))"
            :title="t('theme.numEditHint')"
            :ref="(el) => setEditRef(field.key, el)"
            @dblclick="editingKey = field.key"
            @keydown.enter="commitEdit(field, $event)"
            @keydown.esc="editingKey = null"
            @blur="commitEdit(field, $event)"
          />
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
            <template v-if="pickedRows(field).length">
              <p class="text-[calc(12px*var(--ui-font-scale))] text-ink-3">{{ t("theme.navPickedHeading") }}</p>
              <ul class="flex flex-col">
                <li v-for="row in pickedRows(field)" :key="row.key" class="flex items-center gap-2 py-0.5">
                  <span class="min-w-0 flex-1 truncate text-[calc(13px*var(--ui-font-scale))] text-ink-2" :title="row.label">
                    {{ row.label }}
                  </span>
                  <input
                    class="input h-7 w-28 shrink-0 text-[calc(12px*var(--ui-font-scale))]"
                    type="text"
                    :value="row.custom"
                    :placeholder="t('theme.navRenamePlaceholder')"
                    :title="t('theme.navRenameTitle')"
                    @change="renamePicked(field, row.key, ($event.target as HTMLInputElement).value)"
                  />
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

        <!-- links 字段:友情链接可视化逐条编辑(名称/链接/图标各一框,行文本存储兼容) -->
        <div v-else-if="field.type === 'links'" class="flex flex-col gap-2">
          <div
            v-for="(row, i) in parseLinks(String(fieldValue(field) ?? ''))"
            :key="i"
            class="flex items-center gap-1.5"
          >
            <input
              class="input h-7 w-20 shrink-0 text-[calc(12px*var(--ui-font-scale))]"
              type="text"
              :value="row.name"
              :placeholder="t('theme.linkName')"
              @change="updateLink(field, i, 'name', ($event.target as HTMLInputElement).value)"
            />
            <input
              class="input h-7 min-w-0 flex-1 text-[calc(12px*var(--ui-font-scale))]"
              type="text"
              :value="row.url"
              :placeholder="t('theme.linkUrl')"
              @change="updateLink(field, i, 'url', ($event.target as HTMLInputElement).value)"
            />
            <input
              class="input h-7 w-28 shrink-0 text-[calc(12px*var(--ui-font-scale))]"
              type="text"
              :value="row.icon"
              :placeholder="t('theme.linkIcon')"
              @change="updateLink(field, i, 'icon', ($event.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="btn-icon h-7 w-7 shrink-0 hover:!text-danger"
              :title="t('common.delete')"
              @click="removeLinkRow(field, i)"
            >
              <AppIcon name="trash" :size="12" />
            </button>
          </div>
          <button type="button" class="btn btn-secondary w-fit" @click="addLinkRow(field)">
            <AppIcon name="plus" :size="13" />
            {{ t("theme.linkAdd") }}
          </button>
        </div>

        <!-- 多行文本:如页脚友情链接(每行一条) -->
        <textarea
          v-else-if="field.type === 'textarea'"
          class="input !w-64"
          rows="3"
          :value="String(fieldValue(field))"
          @change="onField(field, ($event.target as HTMLInputElement).value)"
        />
        <!-- 文本:附令牌按钮时,点击把占位符追加到当前值(构建时替换为实际值) -->
        <template v-else>
          <input
            class="input !w-64"
            type="text"
            :value="String(fieldValue(field))"
            @change="onField(field, ($event.target as HTMLInputElement).value)"
          />
          <div v-if="field.tokens?.length" class="flex flex-wrap gap-1">
            <button
              v-for="tok in field.tokens"
              :key="tok"
              type="button"
              class="mono rounded border border-line px-1.5 py-0.5 text-[calc(11px*var(--ui-font-scale))] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              :title="t('theme.insertToken')"
              @click="insertToken(field, tok)"
            >
              {{ tok }}
            </button>
          </div>
        </template>
        <!-- 行为边界说明(来自 theme.json 的 hint):如「首页不显示」之类,在配置处即可见 -->
        <p v-if="field.hint" class="opt-hint">{{ field.hint }}</p>
        </div>
      </template>
    </section>

    <p v-if="!(theme.activeMeta?.config ?? []).length" class="text-[calc(13px*var(--ui-font-scale))] text-ink-3">
      {{ t("common.empty") }}
    </p>

    <!-- 顶栏导航选择弹窗:勾选数量上限内的项,确认后才写入配置 -->
    <Modal v-if="pickerOpen" :title="t('theme.navPickTitle')" :width="420" @cancel="pickerOpen = false">
      <div class="flex min-h-[420px] flex-col">
        <!-- 文件夹默认折叠,点小箭头展开/收起;任意层级的页面均可勾选 -->
        <div
          v-for="row in pickerRows"
          :key="row.opt.key"
          class="navlist-row"
          :class="{ off: draftFull && !draft.has(row.opt.key) }"
          :style="{ paddingLeft: row.depth * 18 + 'px' }"
        >
          <button
            v-if="row.hasChildren"
            type="button"
            class="navlist-caret"
            :aria-label="expandedDirs.has(row.opt.key) ? t('theme.navCollapse') : t('theme.navExpand')"
            @click.stop="toggleDir(row.opt.key)"
          >
            <AppIcon :name="expandedDirs.has(row.opt.key) ? 'chevronDown' : 'chevronRight'" :size="12" />
          </button>
          <span v-else class="navlist-caret-sp" aria-hidden="true" />
          <input
            type="checkbox"
            class="checkbox-input"
            :checked="draft.has(row.opt.key)"
            :disabled="draftFull && !draft.has(row.opt.key)"
            @change="toggleDraft(row.opt.key, ($event.target as HTMLInputElement).checked)"
          />
          <span class="min-w-0 truncate text-[calc(13px*var(--ui-font-scale))] text-ink-2">{{ row.opt.title }}{{ row.opt.dir ? " /" : "" }}</span>
        </div>
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
/* ---------- 分组容器(圆角边框)、悬浮分类栏与分组标题 ---------- */
.cat-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px 16px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-xl);
}
.cat-nav {
  position: sticky;
  /* 视觉吸附位 6px;--cat-top 由脚本按滚动容器的 padding-top 补偿(见 measureCatNav) */
  top: var(--cat-top, 6px);
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
  /* 毛玻璃材质:半透明表面 + 背景模糊,内容从栏后穿过时保持可读 */
  background: color-mix(in srgb, var(--color-surface) 78%, transparent);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  backdrop-filter: blur(14px) saturate(1.5);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-popover);
}
/* 栏底渐变模糊带:滚动内容临近栏底逐渐虚化,避免硬边缘截断(滚动边缘效果) */
.cat-nav::after {
  content: "";
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  height: 14px;
  pointer-events: none;
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  -webkit-mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.85), transparent);
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.85), transparent);
}
@media (prefers-reduced-transparency: reduce) {
  .cat-nav {
    background: var(--color-surface);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .cat-nav::after {
    display: none;
  }
}
.cat-chip {
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-ink-2);
  font-size: calc(12px * var(--ui-font-scale));
  cursor: pointer;
  transition:
    background-color var(--duration-base) var(--ease-plain),
    color var(--duration-base) var(--ease-plain),
    transform 100ms ease-out;
}
.cat-chip:hover {
  background: var(--color-surface-2);
  color: var(--color-ink);
}
.cat-chip:active {
  transform: scale(0.97);
}
.cat-chip:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
.cat-head {
  /* 组内顶部即标题,外间距交给分组容器的内边距与间隙 */
  margin: 0;
  font-size: calc(13.5px * var(--ui-font-scale));
  font-weight: 600;
  color: var(--color-ink-2);
  /* 跳转落点让位悬浮分类栏:距离 = 悬浮间隙 + 栏实际高度 + 渐变模糊带,由 --cat-float 动态给出 */
  scroll-margin-top: var(--cat-float, 76px);
}
.opt-hint {
  margin-top: 2px;
  font-size: calc(11px * var(--ui-font-scale));
  line-height: 1.6;
  color: var(--color-ink-3);
}
@media (prefers-reduced-motion: reduce) {
  .cat-chip {
    transition: none;
  }
  .cat-chip:active {
    transform: none;
  }
}

.navlist-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  cursor: pointer;
  transition: opacity var(--duration-base) var(--ease-plain);
}
/* 插件列表行:启用开关 + 名称 + 文件数 + 删除 */
.plugin-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.navlist-row.off {
  opacity: 0.4;
  cursor: default;
}
/* 文件夹折叠箭头:占位宽度与无子项的缩进占位一致,勾选框始终对齐 */
.navlist-caret {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-ink-3);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-plain),
    color var(--duration-fast) var(--ease-plain);
}
.navlist-caret:hover {
  background: var(--color-surface-2);
  color: var(--color-ink);
}
.navlist-caret-sp {
  width: 18px;
  flex-shrink: 0;
}

/* ---------- 数值原地编辑:数字与输入态共用同一格位(布局零位移)。
   双击前只读展示,编辑态的描边 / 淡色光环 / 微缩放以非线性缓出浮现,
   收起沿同一过渡回原样;系统减弱动态时直接切换 ---------- */
.num-input {
  flex: none;
  width: 56px;
  height: 28px;
  padding: 0 2px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--color-ink-2);
  font-size: calc(12px * var(--ui-font-scale));
  text-align: center;
  cursor: text;
  outline: none;
  transform: scale(1);
  transition:
    border-color 200ms var(--ease-plain),
    background-color 200ms var(--ease-plain),
    box-shadow 260ms var(--ease-plain),
    color 140ms ease,
    transform 260ms var(--ease-pop);
}
.num-input:hover:not(.editing) {
  color: var(--color-ink);
}
.num-input.editing {
  border-color: var(--color-accent);
  background: var(--color-surface);
  color: var(--color-ink);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 15%, transparent);
  transform: scale(1.05);
}
@media (prefers-reduced-motion: reduce) {
  .num-input {
    transition: none;
  }
  .num-input.editing {
    transform: none;
  }
}
</style>
