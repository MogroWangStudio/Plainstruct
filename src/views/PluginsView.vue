<script setup lang="ts">
/** 插件页:站点级插件管理中心 —— 内置插件(应用 + 配置 + 复制为自定义)与
 *  用户自定义插件(导入识别、名称/描述编辑、源码二次开发),全站所有页面生效 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSiteStore } from "@/stores/site";
import { useBuilderStore } from "@/stores/builder";
import { useUiStore } from "@/stores/ui";
import { ipc } from "@/ipc/ipc";
import type { SitePluginEntry } from "@/ipc/types";
import { BUILTIN_PLUGINS, normalizePlugins } from "@/lib/plugins";
import AppIcon from "@/components/AppIcon.vue";
import SelectMenu from "@/components/SelectMenu.vue";
import CodeEditor from "@/components/CodeEditor.vue";
import PromptModal from "@/components/PromptModal.vue";

const { t } = useI18n();
const site = useSiteStore();
const ui = useUiStore();

/* ---------- 插件配置(与旧主题面板插件组同源:normalizePlugins + savePlugins) ---------- */

const plugins = computed(() =>
  site.config
    ? normalizePlugins(site.config)
    : {
        search: true,
        imgPreview: true,
        imgPreviewRequireMark: "mws_ps_imgpreview",
        searchStyle: "button" as const,
        searchPosition: "bottom-right" as const,
        searchStyleM: undefined,
        searchPositionM: undefined,
        searchBarWidth: undefined,
        searchBarWidthM: undefined,
        imgPreviewSharpDelay: undefined,
        imgPreviewCloseDur: undefined,
        imgPreviewCloseEase: undefined,
        imgPreviewClosePreset: undefined,
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

/* ---------- 搜索配置的设备端切换(PC/移动端独立设置,记忆在本地) ---------- */

const deviceMode = ref<"pc" | "m">(
  (() => {
    try {
      return localStorage.getItem("ps-plugin-device") === "m" ? ("m" as const) : ("pc" as const);
    } catch {
      return "pc" as const;
    }
  })(),
);
watch(deviceMode, (v) => {
  try {
    localStorage.setItem("ps-plugin-device", v);
  } catch {
    /* 存储不可用时忽略,仅本次会话内生效 */
  }
});

/* ---------- 图片预览行为:归位动画预设(选中带出时长与曲线,手动改则转自定义) ---------- */

const CLOSE_PRESET_VALUES: Record<string, { dur: number; ease: string }> = {
  标准: { dur: 580, ease: "平滑" },
  轻快: { dur: 380, ease: "缓出" },
  柔和: { dur: 860, ease: "平滑" },
  回弹: { dur: 680, ease: "弹性" },
};

function applyClosePreset(v: string) {
  const hit = CLOSE_PRESET_VALUES[v];
  if (hit) {
    void site.savePlugins({
      imgPreviewClosePreset: v,
      imgPreviewCloseDur: hit.dur,
      imgPreviewCloseEase: hit.ease,
    });
  } else {
    void site.savePlugins({ imgPreviewClosePreset: "自定义" });
  }
}

function setCloseDur(v: number) {
  void site.savePlugins({ imgPreviewCloseDur: v, imgPreviewClosePreset: "自定义" });
}

function setCloseEase(v: string) {
  void site.savePlugins({ imgPreviewCloseEase: v, imgPreviewClosePreset: "自定义" });
}

/* ---------- 卡片展开:内置插件卡片点「配置」就地展开设置 ---------- */

const expanded = ref<Record<string, boolean>>({});
function toggleExpand(key: string) {
  expanded.value = { ...expanded.value, [key]: !expanded.value[key] };
}

/* ---------- 导入(带 Plainstruct 插件识别) ---------- */

async function importPlugin() {
  const result = await site.importPlugin();
  if (!result) return;
  if (result.recognized) {
    ui.toast(
      t("plugins.importRecognized", { name: result.entry.name, version: result.entry.version ?? "" }),
      "success",
    );
  } else {
    ui.toast(t("plugins.importUnrecognized", { name: result.entry.name }), "success");
  }
}

/* ---------- 复制内置插件为自定义 ---------- */

const askOpen = ref(false);
const askTitle = ref("");
const askHint = ref("");
let askResolve: ((v: string | null) => void) | null = null;
let askKey: "search" | "imgPreview" = "search";

function askName(title: string, hint: string, key: "search" | "imgPreview"): Promise<string | null> {
  askTitle.value = title;
  askHint.value = hint;
  askKey = key;
  askOpen.value = true;
  return new Promise((resolve) => {
    askResolve = resolve;
  });
}

async function onAskConfirm(v: string) {
  askOpen.value = false;
  const name = v.trim();
  askResolve?.(name || null);
  askResolve = null;
  if (!name) return;
  try {
    await site.duplicateBuiltinPlugin(askKey, name);
    ui.toast(t("plugins.copied", { name }), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

function onAskCancel() {
  askOpen.value = false;
  askResolve?.(null);
  askResolve = null;
}

/* ---------- 自定义插件:名称/描述编辑 ---------- */

const editingMeta = ref<string | null>(null); // 正在编辑元数据的插件 id
const metaName = ref("");
const metaDesc = ref("");

function startEditMeta(entry: SitePluginEntry) {
  editingMeta.value = entry.id;
  metaName.value = entry.name;
  metaDesc.value = entry.description ?? "";
}

async function commitMeta(id: string) {
  const name = metaName.value.trim();
  if (!name) {
    ui.toast(t("plugins.nameRequired"), "error");
    return;
  }
  await site.savePluginMeta(id, { name, description: metaDesc.value.trim() });
  editingMeta.value = null;
}

/* ---------- 自定义插件:源码二次开发 ---------- */

const editing = ref<string | null>(null); // 正在编辑源码的插件 id
const pluginFiles = ref<{ name: string; content: string }[]>([]);
const activeFile = ref("");
const codeDirty = ref(false);
const loadingCode = ref(false);

async function openEditor(entry: SitePluginEntry) {
  loadingCode.value = true;
  editing.value = entry.id;
  try {
    const [data] = await ipc.readSitePluginFiles([entry]);
    pluginFiles.value = data?.files ?? [];
    activeFile.value = pluginFiles.value[0]?.name ?? "";
    codeDirty.value = false;
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
    editing.value = null;
  } finally {
    loadingCode.value = false;
  }
}

const activeFileContent = computed({
  get: () => pluginFiles.value.find((f) => f.name === activeFile.value)?.content ?? "",
  set: (v: string) => {
    const hit = pluginFiles.value.find((f) => f.name === activeFile.value);
    if (hit) hit.content = v;
    codeDirty.value = true;
  },
});

function langOf(name: string): "css" | "javascript" {
  return name.toLowerCase().endsWith(".css") ? "css" : "javascript";
}

async function saveCode() {
  if (!editing.value) return;
  try {
    for (const f of pluginFiles.value) {
      await site.writePluginFile(editing.value, f.name, f.content);
    }
    codeDirty.value = false;
    // 源码变了:预览内联内容与构建产物都要刷新
    await site.refreshPluginContents();
    useBuilderStore().onSiteChanged();
    ui.toast(t("plugins.codeSaved"), "success");
  } catch (e) {
    ui.toast(t("ui.saveFailed", { msg: ipc.errText(e) }), "error");
  }
}

function closeEditor() {
  if (codeDirty.value) {
    // 有未保存修改:直接退回,改动留在内存(再次进入会重新读盘)
    codeDirty.value = false;
  }
  editing.value = null;
}

/* ---------- 删除自定义插件 ---------- */

async function removePlugin(entry: SitePluginEntry) {
  const ok = await ui.confirmDialog({
    title: t("theme.pluginRemoveTitle"),
    body: t("theme.pluginRemoveBody", { name: entry.name }),
    danger: true,
    confirmText: t("theme.pluginRemove"),
  });
  if (!ok) return;
  if (editing.value === entry.id) editing.value = null;
  await site.removePlugin(entry.id);
}

const customPlugins = computed(() => plugins.value.custom);
const editingEntry = computed(() => customPlugins.value.find((e) => e.id === editing.value) ?? null);

function copySourceOf(entry: SitePluginEntry): string {
  const meta = BUILTIN_PLUGINS.find((m) => m.key === entry.builtinCopyOf);
  return meta ? t(meta.nameKey) : "";
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-bg">
    <!-- 头部 -->
    <header class="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
      <div class="min-w-0">
        <h1 class="text-[calc(15px*var(--ui-font-scale))] font-semibold leading-tight">{{ t("plugins.title") }}</h1>
        <p class="truncate text-[calc(12px*var(--ui-font-scale))] text-ink-3">{{ t("plugins.subtitle") }}</p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <p class="hidden text-[calc(12px*var(--ui-font-scale))] text-ink-3 lg:block">{{ t("plugins.globalHint") }}</p>
        <button class="btn btn-secondary" @click="importPlugin">
          <AppIcon name="download" :size="15" />
          {{ t("theme.pluginImport") }}
        </button>
      </div>
    </header>

    <!-- 源码编辑模式:全宽编辑器 -->
    <template v-if="editingEntry">
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
        <button class="btn btn-ghost btn-sm" @click="closeEditor">
          <AppIcon name="undo" :size="13" />
          {{ t("plugins.backToList") }}
        </button>
        <span class="text-[calc(13px*var(--ui-font-scale))] font-medium">{{ editingEntry.name }}</span>
        <div class="ml-auto flex items-center gap-2">
          <span v-if="codeDirty" class="modified-tag">{{ t("theme.modified") }}</span>
          <button class="btn btn-primary btn-sm" :disabled="!codeDirty" @click="saveCode">
            <AppIcon name="save" :size="13" />
            {{ t("common.save") }}
          </button>
        </div>
      </div>
      <div class="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2">
        <button
          v-for="f in pluginFiles"
          :key="f.name"
          class="file-tab"
          :class="{ active: activeFile === f.name }"
          @click="activeFile = f.name"
        >
          {{ f.name }}
        </button>
      </div>
      <div class="min-h-0 flex-1 bg-surface">
        <CodeEditor v-model="activeFileContent" :language="langOf(activeFile)" />
      </div>
    </template>

    <!-- 卡片列表 -->
    <div v-else class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      <div class="mx-auto max-w-[1080px]">
        <!-- 内置插件 -->
        <h2 class="field-label mb-3">{{ t("plugins.builtin") }}</h2>
        <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section v-for="meta in BUILTIN_PLUGINS" :key="meta.key" class="plugin-card">
            <header class="plugin-card-head">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="plugin-card-name">{{ t(meta.nameKey) }}</span>
                  <span class="mono rounded bg-surface-2 px-1.5 py-0.5 text-[calc(10.5px*var(--ui-font-scale))] text-ink-3">v{{ meta.version }}</span>
                </div>
                <p class="text-[calc(11.5px*var(--ui-font-scale))] text-ink-3">{{ meta.developer }}</p>
              </div>
              <input
                type="checkbox"
                class="checkbox-input"
                :checked="plugins[meta.key]"
                :aria-label="t(meta.nameKey)"
                @change="setBuiltin(meta.key, ($event.target as HTMLInputElement).checked)"
              />
            </header>
            <div class="plugin-card-body">
              <p class="opt-hint">{{ t(meta.descKey) }}</p>
            </div>
            <div class="plugin-card-footer">
              <button type="button" class="btn btn-ghost btn-sm" @click="toggleExpand(meta.key)">
                <AppIcon name="sliders" :size="13" />
                {{ t("plugins.config") }}
                <AppIcon :name="expanded[meta.key] ? 'minus' : 'plus'" :size="12" />
              </button>
              <button type="button" class="btn btn-ghost btn-sm" @click="askName(t('plugins.copyBuiltin'), t(meta.nameKey), meta.key)">
                <AppIcon name="copy" :size="13" />
                {{ t("plugins.copyBuiltin") }}
              </button>
            </div>

            <!-- 展开的配置(临时修改:存站点配置,不改插件源码) -->
            <div v-if="expanded[meta.key]" class="plugin-card-body plugin-config">
              <!-- 站内搜索 -->
              <template v-if="meta.key === 'search'">
                <p class="opt-hint">{{ t("theme.pluginSearchHint") }}</p>

                <label v-if="deviceMode === 'pc'" class="flex flex-col gap-1">
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
                <label v-if="deviceMode === 'pc'" class="flex flex-col gap-1">
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

                <!-- 设备端切换:搜索入口有双端独立设置 -->
                <div class="device-seg" role="group" :aria-label="t('theme.deviceLabel')">
                  <button type="button" class="device-btn" :class="{ active: deviceMode === 'pc' }" @click="deviceMode = 'pc'">
                    <AppIcon name="monitor" :size="13" />
                    {{ t("theme.devicePc") }}
                  </button>
                  <button type="button" class="device-btn" :class="{ active: deviceMode === 'm' }" @click="deviceMode = 'm'">
                    <AppIcon name="smartphone" :size="13" />
                    {{ t("theme.deviceM") }}
                  </button>
                </div>

                <label v-if="deviceMode === 'm'" class="flex flex-col gap-1">
                  <span class="field-label">{{ t("theme.pluginSearchStyleM") }}</span>
                  <SelectMenu
                    :model-value="plugins.searchStyleM ?? ''"
                    :options="[
                      { value: '', label: t('theme.pluginSearchFollowPc') },
                      { value: 'button', label: t('theme.pluginSearchStyleButton') },
                      { value: 'bar', label: t('theme.pluginSearchStyleBar') },
                    ]"
                    align="left"
                    @update:model-value="(v: string) => site.savePlugins({ searchStyleM: (v || undefined) as 'button' | 'bar' | undefined })"
                  />
                  <p class="opt-hint">{{ t("theme.pluginSearchStyleMHint") }}</p>
                </label>
                <label v-if="deviceMode === 'm'" class="flex flex-col gap-1">
                  <span class="field-label">{{ t("theme.pluginSearchPositionM") }}</span>
                  <SelectMenu
                    :model-value="plugins.searchPositionM ?? ''"
                    :options="[
                      { value: '', label: t('theme.pluginSearchFollowPc') },
                      { value: 'bottom-right', label: t('theme.pluginSearchPosBr') },
                      { value: 'bottom-left', label: t('theme.pluginSearchPosBl') },
                      { value: 'topbar', label: t('theme.pluginSearchPosTop') },
                    ]"
                    align="left"
                    @update:model-value="(v: string) => site.savePlugins({ searchPositionM: (v || undefined) as 'bottom-right' | 'bottom-left' | 'topbar' | undefined })"
                  />
                </label>

                <!-- 文本框搜索栏宽度:双端独立 -->
                <div v-if="deviceMode === 'pc' && plugins.searchStyle === 'bar'" class="flex flex-col gap-1">
                  <span class="field-label">{{ t("theme.pluginSearchBarWidth") }}</span>
                  <div class="flex items-center gap-3">
                    <input
                      type="range"
                      class="range-input min-w-0 flex-1"
                      min="160"
                      max="420"
                      step="10"
                      :value="plugins.searchBarWidth ?? 240"
                      @change="site.savePlugins({ searchBarWidth: Number(($event.target as HTMLInputElement).value) })"
                    />
                    <span class="mono w-12 shrink-0 text-right text-[calc(12px*var(--ui-font-scale))] text-ink-2">{{ plugins.searchBarWidth ?? 240 }}px</span>
                    <button
                      v-if="plugins.searchBarWidth !== undefined"
                      type="button"
                      class="btn-icon h-6 w-6 shrink-0"
                      :title="t('theme.resetValue')"
                      @click="site.savePlugins({ searchBarWidth: undefined })"
                    >
                      <AppIcon name="refresh" :size="12" />
                    </button>
                  </div>
                  <p class="opt-hint">{{ t("theme.pluginSearchBarWidthHint") }}</p>
                </div>
                <div v-if="deviceMode === 'm' && (plugins.searchStyleM ?? plugins.searchStyle) === 'bar'" class="flex flex-col gap-1">
                  <span class="field-label">{{ t("theme.pluginSearchBarWidth") }}</span>
                  <div class="flex items-center gap-3">
                    <input
                      type="range"
                      class="range-input min-w-0 flex-1"
                      min="160"
                      max="420"
                      step="10"
                      :value="plugins.searchBarWidthM ?? plugins.searchBarWidth ?? 240"
                      @change="site.savePlugins({ searchBarWidthM: Number(($event.target as HTMLInputElement).value) })"
                    />
                    <span class="mono w-12 shrink-0 text-right text-[calc(12px*var(--ui-font-scale))] text-ink-2">{{ plugins.searchBarWidthM ?? plugins.searchBarWidth ?? 240 }}px</span>
                    <button
                      v-if="plugins.searchBarWidthM !== undefined"
                      type="button"
                      class="btn-icon h-6 w-6 shrink-0"
                      :title="t('theme.pluginSearchFollowPc')"
                      @click="site.savePlugins({ searchBarWidthM: undefined })"
                    >
                      <AppIcon name="refresh" :size="12" />
                    </button>
                  </div>
                  <p class="opt-hint">{{ t("theme.pluginSearchBarWidthMHint") }}</p>
                </div>
              </template>

              <!-- 图片预览 -->
              <template v-else>
                <label class="flex flex-col gap-1">
                  <span class="field-label">{{ t("theme.pluginImgPreviewMark") }}</span>
                  <input
                    class="input !w-64 max-w-full"
                    type="text"
                    :value="plugins.imgPreviewRequireMark"
                    :placeholder="t('theme.pluginImgPreviewMarkPlaceholder')"
                    @change="setImgPreviewMark(($event.target as HTMLInputElement).value)"
                  />
                  <p class="opt-hint">{{ t("theme.pluginImgPreviewMarkHint") }}</p>
                </label>

                <div class="flex flex-col gap-1">
                  <span class="field-label">{{ t("theme.pluginImgSharpDelay") }}</span>
                  <div class="flex items-center gap-3">
                    <input
                      type="range"
                      class="range-input min-w-0 flex-1"
                      min="0"
                      max="2000"
                      step="50"
                      :value="plugins.imgPreviewSharpDelay ?? 500"
                      @change="site.savePlugins({ imgPreviewSharpDelay: Number(($event.target as HTMLInputElement).value) })"
                    />
                    <span class="mono w-14 shrink-0 text-right text-[calc(12px*var(--ui-font-scale))] text-ink-2">
                      {{ (plugins.imgPreviewSharpDelay ?? 500) === 0 ? t("theme.pluginOff") : (plugins.imgPreviewSharpDelay ?? 500) + "ms" }}
                    </span>
                    <button
                      v-if="plugins.imgPreviewSharpDelay !== undefined"
                      type="button"
                      class="btn-icon h-6 w-6 shrink-0"
                      :title="t('theme.resetValue')"
                      @click="site.savePlugins({ imgPreviewSharpDelay: undefined })"
                    >
                      <AppIcon name="refresh" :size="12" />
                    </button>
                  </div>
                  <p class="opt-hint">{{ t("theme.pluginImgSharpDelayHint") }}</p>
                </div>

                <div class="flex flex-col gap-1">
                  <span class="field-label">{{ t("theme.pluginImgClosePreset") }}</span>
                  <SelectMenu
                    :model-value="plugins.imgPreviewClosePreset ?? '标准'"
                    :options="[
                      { value: '标准', label: t('theme.pluginImgClosePresetStd') },
                      { value: '轻快', label: t('theme.pluginImgClosePresetSwift') },
                      { value: '柔和', label: t('theme.pluginImgClosePresetSoft') },
                      { value: '回弹', label: t('theme.pluginImgClosePresetBounce') },
                      { value: '自定义', label: t('theme.pluginImgClosePresetCustom') },
                    ]"
                    align="left"
                    @update:model-value="applyClosePreset"
                  />
                </div>
                <div class="flex flex-col gap-1">
                  <span class="field-label">{{ t("theme.pluginImgCloseDur") }}</span>
                  <div class="flex items-center gap-3">
                    <input
                      type="range"
                      class="range-input min-w-0 flex-1"
                      min="240"
                      max="1200"
                      step="20"
                      :value="plugins.imgPreviewCloseDur ?? 580"
                      @change="setCloseDur(Number(($event.target as HTMLInputElement).value))"
                    />
                    <span class="mono w-14 shrink-0 text-right text-[calc(12px*var(--ui-font-scale))] text-ink-2">{{ plugins.imgPreviewCloseDur ?? 580 }}ms</span>
                  </div>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="field-label">{{ t("theme.pluginImgCloseEase") }}</span>
                  <SelectMenu
                    :model-value="plugins.imgPreviewCloseEase ?? '平滑'"
                    :options="[
                      { value: '平滑', label: t('theme.pluginEaseSmooth') },
                      { value: '缓出', label: t('theme.pluginEaseOut') },
                      { value: '线性', label: t('theme.pluginEaseLinear') },
                      { value: '弹性', label: t('theme.pluginEaseSpring') },
                    ]"
                    align="left"
                    @update:model-value="setCloseEase"
                  />
                </div>
              </template>
            </div>
          </section>
        </div>

        <!-- 自定义插件 -->
        <h2 class="field-label mb-3 mt-8">{{ t("plugins.custom") }}</h2>
        <p
          v-if="!customPlugins.length"
          class="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[calc(13px*var(--ui-font-scale))] text-ink-3"
        >
          {{ t("plugins.noCustom") }}
        </p>
        <div v-else class="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section v-for="entry in customPlugins" :key="entry.id" class="plugin-card">
            <template v-if="editingMeta === entry.id">
              <!-- 名称/描述编辑表单 -->
              <div class="plugin-card-body">
                <label class="flex flex-col gap-1">
                  <span class="field-label">{{ t("plugins.nameLabel") }}</span>
                  <input v-model="metaName" class="input" type="text" @keydown.enter="commitMeta(entry.id)" />
                </label>
                <label class="flex flex-col gap-1">
                  <span class="field-label">{{ t("plugins.descLabel") }}</span>
                  <textarea v-model="metaDesc" class="input min-h-16 resize-y" rows="2"></textarea>
                </label>
              </div>
              <div class="plugin-card-footer">
                <button type="button" class="btn btn-ghost btn-sm" @click="editingMeta = null">{{ t("common.cancel") }}</button>
                <button type="button" class="btn btn-primary btn-sm" @click="commitMeta(entry.id)">{{ t("common.save") }}</button>
              </div>
            </template>

            <template v-else>
              <header class="plugin-card-head">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="plugin-card-name" :title="entry.files.join('\n')">{{ entry.name }}</span>
                    <span v-if="entry.version" class="mono rounded bg-surface-2 px-1.5 py-0.5 text-[calc(10.5px*var(--ui-font-scale))] text-ink-3">v{{ entry.version }}</span>
                    <span v-if="entry.builtinCopyOf" class="rounded bg-surface-2 px-1.5 py-0.5 text-[calc(10.5px*var(--ui-font-scale))] text-ink-3" :title="t('plugins.copyOfBuiltin', { name: copySourceOf(entry) })">
                      {{ t("plugins.copyOfBuiltinShort") }}
                    </span>
                  </div>
                  <p v-if="entry.developer" class="text-[calc(11.5px*var(--ui-font-scale))] text-ink-3">{{ entry.developer }}</p>
                </div>
                <input
                  type="checkbox"
                  class="checkbox-input"
                  :checked="entry.enabled"
                  :aria-label="entry.name"
                  @change="site.setPluginEnabled(entry.id, ($event.target as HTMLInputElement).checked)"
                />
              </header>
              <div class="plugin-card-body">
                <p class="opt-hint">{{ entry.description || t("plugins.noDesc") }}</p>
                <p class="mono text-[calc(11px*var(--ui-font-scale))] text-ink-3">{{ t("theme.pluginFileCount", { n: entry.files.length }) }}</p>
              </div>
              <div class="plugin-card-footer">
                <button type="button" class="btn btn-ghost btn-sm" :title="t('plugins.editInfo')" @click="startEditMeta(entry)">
                  <AppIcon name="pencil" :size="13" />
                  {{ t("plugins.editInfo") }}
                </button>
                <button type="button" class="btn btn-ghost btn-sm" @click="openEditor(entry)">
                  <AppIcon name="code" :size="13" />
                  {{ t("plugins.editCode") }}
                </button>
                <button type="button" class="btn-icon h-7 w-7 shrink-0 hover:!text-danger" :title="t('theme.pluginRemove')" @click="removePlugin(entry)">
                  <AppIcon name="trash" :size="13" />
                </button>
              </div>
            </template>
          </section>
        </div>

        <p class="opt-hint mt-6">{{ t("theme.pluginHint") }}</p>
      </div>
    </div>

    <!-- 复制内置插件命名 -->
    <PromptModal
      :open="askOpen"
      :title="askTitle"
      :label="t('plugins.nameLabel')"
      :placeholder="askHint"
      :initial="askHint"
      :confirm-text="t('common.create')"
      @confirm="onAskConfirm"
      @cancel="onAskCancel"
    />
  </div>
</template>

<style scoped>
/* 插件卡片:圆角卡片,标题行(名称 + 版本 + 开关)、简介与操作区三段式 */
.plugin-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 14px 16px;
}
.plugin-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.plugin-card-name {
  font-size: calc(13.5px * var(--ui-font-scale));
  font-weight: 600;
  color: var(--color-ink);
}
.plugin-card-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}
.plugin-config {
  border-top: 1px dashed var(--color-line);
  padding-top: 12px;
  margin-top: 4px;
}
.plugin-card-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}
.file-tab {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-ink-3);
  font-size: calc(12px * var(--ui-font-scale));
  cursor: pointer;
}
.file-tab:hover {
  background: var(--color-surface-2);
  color: var(--color-ink-2);
}
.file-tab.active {
  background: var(--color-surface-2);
  color: var(--color-ink);
  font-weight: 500;
}
.modified-tag {
  font-size: calc(11px * var(--ui-font-scale));
  color: var(--color-accent);
}
.device-seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  width: fit-content;
}
.device-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-ink-3);
  font-size: calc(12px * var(--ui-font-scale));
  cursor: pointer;
}
.device-btn.active {
  background: var(--color-surface-2);
  color: var(--color-ink);
}
</style>
