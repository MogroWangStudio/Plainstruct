<script setup lang="ts">
/** 主题页:列表 + 配置面板 + 主题制作器(代码编辑 + 实时预览 + ZIP 导入导出) */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSiteStore } from "@/stores/site";
import { useThemeStore } from "@/stores/theme";
import { useUiStore } from "@/stores/ui";
import { ipc } from "@/ipc/ipc";
import type { ThemeMeta } from "@/ipc/types";
import AppIcon from "@/components/AppIcon.vue";
import ThemeConfigPanel from "@/components/ThemeConfigPanel.vue";
import ThemePreview from "@/components/ThemePreview.vue";
import CodeEditor from "@/components/CodeEditor.vue";
import PromptModal from "@/components/PromptModal.vue";

const { t } = useI18n();
const site = useSiteStore();
const theme = useThemeStore();
const ui = useUiStore();

const tab = ref<"config" | "maker">("config");

function isActive(meta: ThemeMeta): boolean {
  return site.config?.theme.id === meta.id && sourceOf(meta) === site.config?.theme.source;
}
function sourceOf(meta: ThemeMeta): "builtin" | "custom" {
  return meta.source;
}

async function activate(meta: ThemeMeta) {
  await theme.selectTheme(meta.id, sourceOf(meta));
  tab.value = "config";
}

async function edit(meta: ThemeMeta) {
  try {
    if (meta.source === "builtin") {
      // 内置主题不可改,先复制为自定义
      const name = await askName(t("theme.newFrom"), meta.name);
      if (!name) return;
      const created = await theme.createFrom("builtin", meta.id, name);
      await theme.startEditing(created.id, "custom");
    } else {
      await theme.startEditing(meta.id, "custom");
    }
    tab.value = "maker";
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

async function exportTheme(meta: ThemeMeta) {
  const dest = await ipc.pickZipDest(`${meta.id}.zip`);
  if (!dest) return;
  try {
    if (meta.source === "custom") {
      const files = await ipc.readThemeFiles(meta.id);
      await ipc.exportThemeZip(files, dest);
    } else {
      await theme.exportBuiltin(meta.id, dest);
    }
    ui.toast(t("theme.exportDone"), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

async function removeTheme(meta: ThemeMeta) {
  const ok = await ui.confirmDialog({
    title: t("theme.deleteTheme"),
    body: t("theme.deleteThemeBody", { name: meta.name }),
    danger: true,
    confirmText: t("common.delete"),
  });
  if (!ok) return;
  await theme.deleteCustom(meta.id);
  if (theme.editing?.id === meta.id) theme.editing = null;
}

async function importZip() {
  const zipPath = await ipc.pickThemeZip();
  if (!zipPath) return;
  try {
    const meta = await theme.importZip(zipPath);
    await theme.startEditing(meta.id, "custom");
    tab.value = "maker";
  } catch (e) {
    ui.toast(t("theme.importFailed", { msg: ipc.errText(e) }), "error");
  }
}

/* ---------- 名称询问 ---------- */

const askOpen = ref(false);
const askTitle = ref("");
const askHint = ref("");
let askResolve: ((v: string | null) => void) | null = null;

function askName(title: string, hint: string): Promise<string | null> {
  askTitle.value = title;
  askHint.value = hint;
  askOpen.value = true;
  return new Promise((resolve) => {
    askResolve = resolve;
  });
}

function onAskConfirm(v: string) {
  askOpen.value = false;
  askResolve?.(v.trim() || null);
  askResolve = null;
}

function onAskCancel() {
  askOpen.value = false;
  askResolve?.(null);
  askResolve = null;
}

/** 复制当前选中的主题(内置或自定义),完成后自动选中新主题 */
async function duplicateActive() {
  const base = theme.activeMeta;
  if (!base) return;
  const name = await askName(t("theme.duplicateThis"), base.name);
  if (!name) return;
  try {
    const created = await theme.createFrom(sourceOf(base), base.id, name);
    await theme.adoptAsCustom(created.id);
    tab.value = "config";
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

/* ---------- 制作器 ---------- */

const editingFiles = computed(() =>
  theme.editing ? Object.keys(theme.editing.files).sort() : [],
);

const activeFileContent = computed({
  get: () => theme.editing?.files[theme.editingActiveFile] ?? "",
  set: (v: string) => theme.setEditingFile(theme.editingActiveFile, v),
});

function langOf(path: string): "html" | "css" | "json" | "markdown" {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".css")) return "css";
  return "html";
}

const makerDirty = ref(false);
watch(activeFileContent, () => (makerDirty.value = true));

async function saveMaker() {
  if (!theme.editing) return;
  try {
    JSON.parse(theme.editing.files["theme.json"] ?? "{}");
  } catch {
    ui.toast(t("theme.invalidJson"), "error");
    return;
  }
  try {
    await theme.saveEditing();
    makerDirty.value = false;
    ui.toast(t("theme.filesSaved"), "success");
  } catch (e) {
    ui.toast(t("ui.saveFailed", { msg: ipc.errText(e) }), "error");
  }
}

async function exportMaker() {
  if (!theme.editing) return;
  const dest = await ipc.pickZipDest(`${theme.editing.id}.zip`);
  if (!dest) return;
  try {
    await theme.exportEditing(dest);
    ui.toast(t("theme.exportDone"), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

/* ---------- 站点当前主题引用的补充(编辑中的主题仍被站点使用时) ---------- */

const activeLabel = computed(() => theme.activeMeta?.name ?? "-");

/* ---------- 预览刷新 ---------- */

const themePreviewRef = ref<InstanceType<typeof ThemePreview>>();
const previewSpinning = ref(false);

function refreshPreview() {
  themePreviewRef.value?.refresh();
  previewSpinning.value = false;
  window.setTimeout(() => {
    previewSpinning.value = true;
    window.setTimeout(() => (previewSpinning.value = false), 650);
  });
}

/* ---------- 内置主题被修改:提示复制为新主题 ---------- */

const copyAskOpen = ref(false);
const activeBuiltinName = computed(() => {
  const meta = theme.activeMeta;
  return meta && site.config?.theme.source === "builtin" ? meta.name : "";
});

watch(
  () => theme.suggestCopyForBuiltin,
  (v) => {
    if (v) copyAskOpen.value = true;
  },
);

function dismissCopyAsk() {
  copyAskOpen.value = false;
  theme.dismissCopySuggestion();
}

async function confirmCopyAsk() {
  copyAskOpen.value = false;
  const base = theme.activeMeta;
  if (!base) return;
  const name = await askName(t("theme.newFrom"), base.name);
  if (!name) return;
  try {
    const created = await theme.createFrom("builtin", base.id, name);
    await theme.adoptAsCustom(created.id);
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

/* ---------- 重置主题配置 ---------- */

async function resetConfig() {
  const meta = theme.activeMeta;
  if (!meta) return;
  const ok = await ui.confirmDialog({
    title: t("theme.resetConfig"),
    body: t("theme.resetConfigBody", { name: meta.name }),
    confirmText: t("theme.resetConfirm"),
  });
  if (!ok) return;
  try {
    await theme.resetConfigValues();
    ui.toast(t("theme.resetDone"), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-bg">
    <!-- 头部 -->
    <header class="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
      <div class="min-w-0">
        <h1 class="text-[calc(15px*var(--ui-font-scale))] font-semibold leading-tight">{{ t("theme.title") }}</h1>
        <p class="truncate text-[calc(12px*var(--ui-font-scale))] text-ink-3">{{ t("theme.subtitle") }}</p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <button class="btn btn-secondary" @click="importZip">
          <AppIcon name="download" :size="15" />
          {{ t("theme.importZip") }}
        </button>
        <button class="btn btn-secondary" @click="duplicateActive">
          <AppIcon name="copy" :size="15" />
          {{ t("theme.duplicateThis") }}
        </button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- 主题列表 -->
      <aside class="w-[264px] shrink-0 overflow-y-auto border-r border-line bg-surface">
        <div class="p-3">
          <h2 class="field-label mb-1">{{ t("theme.builtin") }}</h2>
          <div class="flex flex-col gap-1">
            <div
              v-for="meta in theme.builtinForSite"
              :key="meta.id"
              class="theme-item"
              :class="{ current: isActive(meta) }"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-[calc(13px*var(--ui-font-scale))] font-medium">{{ meta.name }}</p>
                <!-- 版本行:标签放在 truncate 之外,避免被省略号截断 -->
                <div class="flex min-w-0 items-center">
                  <p class="mono min-w-0 truncate text-[calc(11px*var(--ui-font-scale))] text-ink-3">v{{ meta.version }}</p>
                  <span
                    v-if="isActive(meta) && theme.builtinConfigModified"
                    class="modified-tag"
                    :title="t('theme.modifiedHint')"
                  >
                    {{ t("theme.modified") }}
                  </span>
                </div>
              </div>
              <span v-if="isActive(meta)" class="badge">{{ t("theme.active") }}</span>
              <div class="item-actions flex items-center gap-0.5">
                <button v-if="!isActive(meta)" class="btn-icon !h-7 !w-7" :title="t('theme.setActive')" @click="activate(meta)">
                  <AppIcon name="check" :size="14" />
                </button>
                <button class="btn-icon !h-7 !w-7" :title="t('theme.newFrom')" @click="edit(meta)">
                  <AppIcon name="pencil" :size="14" />
                </button>
                <button class="btn-icon !h-7 !w-7" :title="t('theme.exportZip')" @click="exportTheme(meta)">
                  <AppIcon name="download" :size="14" />
                </button>
              </div>
            </div>
          </div>

          <h2 class="field-label mb-1 mt-5">{{ t("theme.custom") }}</h2>
          <p v-if="!theme.customForSite.length" class="rounded-lg border border-dashed border-line px-3 py-4 text-[calc(12px*var(--ui-font-scale))] leading-relaxed text-ink-3">
            {{ t("theme.noCustom") }}
          </p>
          <div v-else class="flex flex-col gap-1">
            <div
              v-for="meta in theme.customForSite"
              :key="meta.id"
              class="theme-item"
              :class="{ current: isActive(meta) }"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-[calc(13px*var(--ui-font-scale))] font-medium">{{ meta.name }}</p>
                <p class="mono truncate text-[calc(11px*var(--ui-font-scale))] text-ink-3">v{{ meta.version }}</p>
              </div>
              <span v-if="isActive(meta)" class="badge">{{ t("theme.active") }}</span>
              <div class="item-actions flex items-center gap-0.5">
                <button v-if="!isActive(meta)" class="btn-icon !h-7 !w-7" :title="t('theme.setActive')" @click="activate(meta)">
                  <AppIcon name="check" :size="14" />
                </button>
                <button class="btn-icon !h-7 !w-7" :title="t('theme.maker')" @click="edit(meta)">
                  <AppIcon name="pencil" :size="14" />
                </button>
                <button class="btn-icon !h-7 !w-7" :title="t('theme.exportZip')" @click="exportTheme(meta)">
                  <AppIcon name="download" :size="14" />
                </button>
                <button class="btn-icon !h-7 !w-7 hover:!text-danger" :title="t('theme.deleteTheme')" @click="removeTheme(meta)">
                  <AppIcon name="trash" :size="14" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- 右侧:配置 / 制作 -->
      <section class="flex min-w-0 flex-1 flex-col">
        <div class="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-surface px-4">
          <button class="tab-btn" :class="{ active: tab === 'config' }" @click="tab = 'config'">
            {{ t("theme.config") }} · {{ activeLabel }}
          </button>
          <button class="tab-btn" :class="{ active: tab === 'maker' }" :disabled="!theme.editing" @click="tab = 'maker'">
            {{ t("theme.maker") }}
          </button>
        </div>

        <div class="flex min-h-0 flex-1">
          <!-- 左:配置面板或代码编辑 -->
          <div class="flex min-w-0 flex-1 flex-col">
            <template v-if="tab === 'config'">
              <div class="min-h-0 flex-1 overflow-y-auto p-6">
                <div class="mb-6 flex items-center justify-between gap-4">
                  <p class="field-hint !mt-0">{{ t("theme.configHint") }}</p>
                  <button class="btn btn-ghost btn-sm shrink-0" @click="resetConfig">
                    <AppIcon name="restore" :size="14" />
                    {{ t("theme.resetConfig") }}
                  </button>
                </div>
                <ThemeConfigPanel />
              </div>
            </template>

            <template v-else-if="theme.editing">
              <!-- 文件标签 -->
              <div class="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2">
                <button
                  v-for="file in editingFiles"
                  :key="file"
                  class="file-tab"
                  :class="{ active: theme.editingActiveFile === file }"
                  @click="theme.editingActiveFile = file"
                >
                  {{ file }}
                </button>
              </div>
              <div class="min-h-0 flex-1 bg-surface">
                <CodeEditor v-model="activeFileContent" :language="langOf(theme.editingActiveFile)" />
              </div>
              <div class="flex h-12 shrink-0 items-center gap-2 border-t border-line bg-surface px-4">
                <span class="text-[calc(12px*var(--ui-font-scale))] text-ink-3">{{ theme.editing.name }}</span>
                <div class="ml-auto flex gap-2">
                  <button class="btn btn-secondary" @click="exportMaker">
                    <AppIcon name="download" :size="14" />
                    {{ t("theme.exportZip") }}
                  </button>
                  <button class="btn btn-primary" :disabled="!makerDirty" @click="saveMaker">
                    {{ t("theme.saveFiles") }}
                  </button>
                </div>
              </div>
            </template>

            <div v-else class="flex flex-1 items-center justify-center text-[calc(13px*var(--ui-font-scale))] text-ink-3">
              {{ t("theme.noCustom") }}
            </div>
          </div>

          <!-- 右:实时预览 -->
          <div class="flex w-[46%] min-w-[320px] shrink-0 flex-col border-l border-line">
            <div class="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
              <span class="text-[calc(12.5px*var(--ui-font-scale))] font-semibold text-ink-2">{{ t("theme.previewDoc") }}</span>
              <button
                class="btn-icon ml-auto !h-7 !w-7"
                :title="t('common.refresh')"
                @click="refreshPreview"
              >
                <AppIcon name="refresh" :size="15" :class="{ 'spin-once': previewSpinning }" />
              </button>
            </div>
            <div class="min-h-0 flex-1">
              <ThemePreview ref="themePreviewRef" :follow-editing="tab === 'maker'" />
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 命名询问 -->
    <PromptModal
      :open="askOpen"
      :title="askTitle"
      :label="t('theme.newName')"
      :placeholder="askHint"
      :confirm-text="t('common.create')"
      @confirm="onAskConfirm"
      @cancel="onAskCancel"
    />

    <!-- 内置主题被修改:提示复制为新主题 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="copyAskOpen" class="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div class="modal-scrim absolute inset-0" />
          <div class="modal-card panel relative w-full max-w-[380px] shadow-window">
            <header class="px-6 pb-2 pt-5">
              <h2 class="text-[calc(16px*var(--ui-font-scale))] font-semibold">{{ t("theme.modifiedTitle") }}</h2>
            </header>
            <div class="px-6">
              <p class="text-[calc(13.5px*var(--ui-font-scale))] leading-relaxed text-ink-2">
                {{ t("theme.modifiedBody", { name: activeBuiltinName }) }}
              </p>
            </div>
            <footer class="flex justify-end gap-2 border-t border-line px-6 py-4">
              <button class="btn btn-secondary" @click="dismissCopyAsk">
                {{ t("theme.modifiedDismiss") }}
              </button>
              <button class="btn btn-primary" @click="confirmCopyAsk">
                {{ t("theme.modifiedConfirm") }}
              </button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.theme-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  transition:
    background-color var(--duration-base) var(--ease-plain),
    border-color var(--duration-base) var(--ease-plain);
}
.theme-item:hover {
  background: var(--color-surface-2);
}
.theme-item.current {
  border-color: var(--color-line);
  background: var(--color-surface-2);
}
.theme-item .item-actions {
  opacity: 0;
  transition: opacity var(--duration-base) var(--ease-plain);
}
.theme-item:hover .item-actions {
  opacity: 1;
}

.badge {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--color-accent);
  color: var(--color-on-accent);
  font-size: calc(10.5px * var(--ui-font-scale));
  font-weight: 600;
  letter-spacing: 0.02em;
}

/* 内置主题配置偏离默认值的标识:独立 flex 项,不被版本号截断,也不与"当前主题"实底徽标抢层级 */
.modified-tag {
  flex-shrink: 0;
  margin-left: 4px;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--color-line-strong);
  background: var(--color-surface);
  color: var(--color-ink-2);
  font-family: var(--font-sans);
  font-size: calc(10.5px * var(--ui-font-scale));
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  animation: badge-pop 340ms var(--ease-pop) both;
}
@keyframes badge-pop {
  from {
    opacity: 0;
    transform: scale(0.85);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* 刷新按钮点击后的单圈旋转 */
.spin-once {
  animation: icon-spin 620ms var(--ease-plain);
}
@keyframes icon-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.tab-btn {
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-ink-2);
  font-size: calc(12.5px * var(--ui-font-scale));
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--duration-base) var(--ease-plain),
    color var(--duration-base) var(--ease-plain);
}
.tab-btn:hover {
  background: var(--color-surface-2);
}
.tab-btn.active {
  background: var(--color-surface-3);
  color: var(--color-ink);
}
.tab-btn:disabled {
  opacity: 0.4;
  pointer-events: none;
}

.file-tab {
  flex-shrink: 0;
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-ink-2);
  font-size: calc(11.5px * var(--ui-font-scale));
  cursor: pointer;
  transition:
    background-color var(--duration-base) var(--ease-plain),
    color var(--duration-base) var(--ease-plain);
}
.file-tab:hover {
  background: var(--color-surface-2);
}
.file-tab.active {
  background: var(--color-surface-3);
  color: var(--color-ink);
}
</style>
