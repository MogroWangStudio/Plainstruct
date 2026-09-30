<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore } from "@/stores/app";
import { useUiStore } from "@/stores/ui";
import { ipc } from "@/ipc/ipc";
import type { ConfettiLevel, EditorBreakKey, EditorFontMode, EditorIndentKey, Locale, UiFontSize, UiFontMode, UiFontWeight } from "@/ipc/types";
import { APP_THEMES, type AppThemeSwatch } from "@/lib/app-themes";
import { formatSize } from "@/lib/format";
import AppIcon from "@/components/AppIcon.vue";
import SelectMenu from "@/components/SelectMenu.vue";

const { t } = useI18n();
const app = useAppStore();
const ui = useUiStore();

const localeOptions: { value: Locale; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
];

const localeModel = computed({
  get: () => app.settings.locale,
  set: (v: Locale) => void app.setLocale(v),
});

async function onAutosaveToggle() {
  await app.setAutosave(!app.settings.autosave);
}

/* ---------- 编辑器写作偏好(空白标记与键位) ---------- */

const whitespaceModel = computed({
  get: () => app.settings.editorWhitespace ?? true,
  set: (v: boolean) => void app.setEditorPrefs({ editorWhitespace: v }),
});

async function onWhitespaceToggle() {
  await app.setEditorPrefs({ editorWhitespace: !(app.settings.editorWhitespace ?? true) });
}

const breakKeyOptions = computed<{ value: EditorBreakKey; label: string }[]>(() => [
  { value: "enter", label: t("settings.breakEnter") },
  { value: "modEnter", label: t("settings.breakModEnter") },
  { value: "none", label: t("settings.keyNone") },
]);

const breakKeyModel = computed({
  get: () => app.settings.editorBreakKey ?? "enter",
  set: (v: EditorBreakKey) => void app.setEditorPrefs({ editorBreakKey: v }),
});

const indentKeyOptions = computed<{ value: EditorIndentKey; label: string }[]>(() => [
  { value: "tab", label: t("settings.indentTab") },
  { value: "modShiftI", label: t("settings.indentModShiftI") },
  { value: "none", label: t("settings.keyNone") },
]);

const indentKeyModel = computed({
  get: () => app.settings.editorIndentKey ?? "tab",
  set: (v: EditorIndentKey) => void app.setEditorPrefs({ editorIndentKey: v }),
});

const indentWidthOptions = computed<{ value: string; label: string }[]>(() =>
  [1, 2, 3, 4].map((n) => ({ value: String(n), label: t("settings.indentWidthN", { n }) })),
);

const indentWidthModel = computed({
  get: () => String(app.settings.editorIndentWidth ?? 2),
  set: (v: string) => void app.setEditorPrefs({ editorIndentWidth: Number(v) }),
});

/* ---------- 个性化(主题与字体) ---------- */

/** 跟随系统的预览色板:浅色/深色对半拼接,线条与文字用两侧均可读的中性色 */
const DUAL_SWATCH: AppThemeSwatch = {
  bg: "linear-gradient(102deg, #fafaf9 49.7%, #171514 50.3%)",
  panel: "linear-gradient(102deg, #efedec 49.7%, #2d2a27 50.3%)",
  line: "#c9c3be",
  text: "rgba(115, 108, 102, 0.65)",
  accent: "rgba(115, 108, 102, 0.85)",
};

/** 把色板注入 mini 预览的局部 CSS 变量 */
function miniVars(s: AppThemeSwatch): Record<string, string> {
  return {
    "--sw-bg": s.bg,
    "--sw-panel": s.panel,
    "--sw-line": s.line,
    "--sw-text": s.text,
    "--sw-accent": s.accent,
  };
}

const themeModel = computed({
  get: () => app.settings.theme ?? "system",
  set: (v: (typeof APP_THEMES)[number]["id"]) => void app.setAppearance({ theme: v }),
});

const uiFontOptions = computed<{ value: UiFontMode; label: string }[]>(() => [
  { value: "system", label: t("settings.fontSystem") },
  { value: "serif", label: t("settings.fontSerif") },
  { value: "mono", label: t("settings.fontMono") },
  { value: "custom", label: t("settings.fontCustom") },
]);

const confettiOptions = computed<{ value: ConfettiLevel; label: string }[]>(() => [
  { value: "off", label: t("settings.confettiOff") },
  { value: "light", label: t("settings.confettiLight") },
  { value: "standard", label: t("settings.confettiStandard") },
  { value: "grand", label: t("settings.confettiGrand") },
]);

const uiFontSizeOptions = computed<{ value: UiFontSize; label: string }[]>(() => [
  { value: "small", label: t("settings.uiFontSizeSmall") },
  { value: "default", label: t("settings.uiFontSizeDefault") },
  { value: "large", label: t("settings.uiFontSizeLarge") },
  { value: "xlarge", label: t("settings.uiFontSizeXLarge") },
]);

const uiFontWeightOptions = computed<{ value: UiFontWeight; label: string }[]>(() => [
  { value: "normal", label: t("settings.uiFontWeightNormal") },
  { value: "medium", label: t("settings.uiFontWeightMedium") },
  { value: "semibold", label: t("settings.uiFontWeightSemibold") },
]);

const editorFontOptions = computed<{ value: EditorFontMode; label: string }[]>(() => [
  { value: "default", label: t("settings.fontEditorDefault") },
  { value: "ui", label: t("settings.fontUi") },
  { value: "serif", label: t("settings.fontSerif") },
  { value: "custom", label: t("settings.fontCustom") },
]);

const uiFontModel = computed({
  get: () => app.settings.uiFont ?? "system",
  set: (v: UiFontMode) => void app.setAppearance({ uiFont: v }),
});
const uiFontSizeModel = computed({
  get: () => app.settings.uiFontSize ?? "default",
  set: (v: UiFontSize) => void app.setAppearance({ uiFontSize: v }),
});
const uiFontWeightModel = computed({
  get: () => app.settings.uiFontWeight ?? "normal",
  set: (v: UiFontWeight) => void app.setAppearance({ uiFontWeight: v }),
});
const editorFontModel = computed({
  get: () => app.settings.editorFont ?? "default",
  set: (v: EditorFontMode) => void app.setAppearance({ editorFont: v }),
});

function onUiFontCustom(e: Event) {
  void app.setAppearance({ uiFontCustom: (e.target as HTMLInputElement).value });
}
function onEditorFontCustom(e: Event) {
  void app.setAppearance({ editorFontCustom: (e.target as HTMLInputElement).value });
}

/* ---------- 数据存储位置 ---------- */

const dataMoving = ref(false);
const dataError = ref("");

async function pickDataDir() {
  const dir = await ipc.pickDirectory();
  if (!dir) return;
  dataMoving.value = true;
  dataError.value = "";
  try {
    await app.setDataDir(dir);
  } catch (e) {
    dataError.value = ipc.errText(e);
  }
  dataMoving.value = false;
}

async function resetDataDir() {
  dataMoving.value = true;
  dataError.value = "";
  try {
    await app.setDataDir(null);
  } catch (e) {
    dataError.value = ipc.errText(e);
  }
  dataMoving.value = false;
}

function openDataDir() {
  void ipc.openDataDir();
}

/* ---------- 启动白屏急救:清除 WebView 浏览数据后重载 ---------- */

const repairing = ref(false);

async function repairWebview() {
  const ok = await ui.confirmDialog({
    title: t("settings.repairWebviewConfirmTitle"),
    body: t("settings.repairWebviewConfirmBody"),
    confirmText: t("settings.repairWebview"),
  });
  if (!ok) return;
  repairing.value = true;
  try {
    await ipc.repairWebviewData();
    // 清理完成后整页重载;重载本身即是反馈,不再叠 toast
    window.location.reload();
  } catch (e) {
    repairing.value = false;
    ui.toast(t("settings.repairWebviewFailed", { msg: ipc.errText(e) }), "error");
  }
}

/* ---------- 类别分页:一次只显示一个类别,按导航次序决定滑入方向 ---------- */

const sections = computed(() => [
  { id: "language", label: t("settings.sectionLanguage") },
  { id: "editor", label: t("settings.sectionEditor") },
  { id: "personalization", label: t("settings.sectionPersonalization") },
  { id: "data", label: t("settings.sectionData") },
  { id: "about", label: t("settings.sectionAbout") },
]);

const active = ref("language");
/** 切换方向:向下切换 = 新页自下方滑入,向上切换反之 */
const direction = ref<"up" | "down">("down");

function goTo(id: string) {
  if (id === active.value) return;
  const from = sections.value.findIndex((s) => s.id === active.value);
  const to = sections.value.findIndex((s) => s.id === id);
  direction.value = to > from ? "down" : "up";
  active.value = id;
}

/* ---------- 检查更新(以 GitHub 最新 Release 为准) ---------- */

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "available"; version: string; url: string }
  | { kind: "error"; message: string };

const update = ref<UpdateState>({ kind: "idle" });

/** 更新流程进行中(下载/暂停):左栏展示包名与进度明细 */
const downloading = computed(() => app.updatePhase === "downloading" || app.updatePhase === "paused");

const updateHint = computed(() => {
  switch (app.updatePhase) {
    case "downloading":
      return t("settings.updateDownloading");
    case "paused":
      return t("settings.updatePaused");
    case "ready":
      return t("settings.updateReady", { v: app.updateVersion });
  }
  switch (update.value.kind) {
    case "checking":
      return t("settings.checking");
    case "latest":
      return t("settings.upToDate");
    case "available":
      return t("settings.updateAvailable", { v: update.value.version });
    case "error":
      return t("settings.checkFailed", { msg: update.value.message });
    default:
      return t("settings.checkUpdateHint");
  }
});

const hintTone = computed(() => {
  if (app.updatePhase === "ready" || update.value.kind === "available") return "text-accent";
  if (update.value.kind === "error") return "text-danger";
  return "text-ink-3";
});

/** 自动更新行:阶段与下载进度 */
const updateBar = computed(() =>
  app.updateProgress >= 0 ? `${app.updateProgress}%` : "100%",
);

const speedText = computed(() => {
  const s = formatSize(app.updateSpeed);
  return s ? `${s}/s` : "";
});

/** 重启并更新:确认后关闭应用并拉起更新向导 */
async function restartUpdate() {
  const go = await app.confirmRestart(app.updateVersion);
  if (go) await app.restartToUpdate();
}

async function checkUpdate() {
  update.value = { kind: "checking" };
  try {
    const info = await ipc.checkUpdate();
    if (!info.hasUpdate) {
      update.value = { kind: "latest" };
      return;
    }
    update.value = { kind: "available", version: info.latestVersion, url: info.releaseUrl };
    // 检测到新版本:询问用户是否立即下载更新
    const go = await app.confirmUpdate(info.latestVersion);
    if (go) void app.updateDownload();
  } catch (e) {
    update.value = { kind: "error", message: ipc.errText(e) };
  }
}

function openRelease(url: string) {
  if (url) void ipc.openExternal(url);
}
</script>

<template>
  <div class="flex h-full">
    <!-- 左侧:类别导航(点击切换,右侧仅显示当前类别) -->
    <aside class="flex w-[208px] shrink-0 flex-col border-r border-line bg-surface">
      <div class="flex items-center gap-2 px-3 pb-2 pt-4">
        <button class="btn-icon" :title="t('common.back')" @click="app.setView('editor')">
          <AppIcon name="arrowLeft" :size="17" />
        </button>
        <h2 class="truncate text-[14.5px] font-semibold tracking-tight">{{ t("settings.title") }}</h2>
      </div>
      <p class="px-4 text-[11.5px] leading-relaxed text-ink-3">{{ t("settings.subtitle") }}</p>

      <nav class="mt-5 flex flex-col gap-0.5 px-2">
        <button
          v-for="s in sections"
          :key="s.id"
          class="settings-nav-item"
          :class="{ active: active === s.id }"
          @click="goTo(s.id)"
        >
          {{ s.label }}
        </button>
      </nav>

      <div class="mt-auto px-4 pb-4 text-[11px] text-ink-3 mono">v{{ app.version }}</div>
    </aside>

    <!-- 右侧:当前类别页(切换时整体按方向滑动淡入,行内设置次第浮现) -->
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <Transition name="settings-page" mode="out-in">
        <div :key="active" class="absolute inset-0 overflow-y-auto" :data-dir="direction">
          <div class="mx-auto w-full max-w-[640px] px-8 pb-10 pt-8">
            <!-- 语言 -->
            <template v-if="active === 'language'">
              <h3 class="settings-heading" style="--i: 0">
                {{ t("settings.sectionLanguage") }}
              </h3>
              <div class="settings-card">
                <div class="settings-row" style="--i: 0">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.language") }}</p>
                    <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ t("settings.languageHint") }}</p>
                  </div>
                  <SelectMenu v-model="localeModel" :options="localeOptions" align="right" class="shrink-0" />
                </div>
              </div>
            </template>

            <!-- 编辑器 -->
            <template v-else-if="active === 'editor'">
              <h3 class="settings-heading" style="--i: 0">
                {{ t("settings.sectionEditor") }}
              </h3>
              <div class="settings-card">
                <div class="settings-row" style="--i: 0">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.autosave") }}</p>
                    <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ t("settings.autosaveHint") }}</p>
                  </div>
                  <button
                    class="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors"
                    :class="app.settings.autosave ? 'bg-accent' : 'bg-line-strong'"
                    role="switch"
                    :aria-checked="app.settings.autosave"
                    @click="onAutosaveToggle"
                  >
                    <span
                      class="inline-block h-4 w-4 rounded-full bg-surface shadow-sm transition-transform"
                      :class="app.settings.autosave ? 'translate-x-[22px]' : 'translate-x-[4px]'"
                    />
                  </button>
                </div>
              </div>

              <h3 class="settings-heading" style="--i: 1">
                {{ t("settings.sectionWriting") }}
              </h3>
              <div class="settings-card">
                <div class="settings-row" style="--i: 0">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.editorWhitespace") }}</p>
                    <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ t("settings.editorWhitespaceHint") }}</p>
                  </div>
                  <button
                    class="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors"
                    :class="whitespaceModel ? 'bg-accent' : 'bg-line-strong'"
                    role="switch"
                    :aria-checked="whitespaceModel"
                    @click="onWhitespaceToggle"
                  >
                    <span
                      class="inline-block h-4 w-4 rounded-full bg-surface shadow-sm transition-transform"
                      :class="whitespaceModel ? 'translate-x-[22px]' : 'translate-x-[4px]'"
                    />
                  </button>
                </div>
                <div class="settings-row" style="--i: 1">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.editorBreakKey") }}</p>
                    <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ t("settings.editorBreakKeyHint") }}</p>
                  </div>
                  <SelectMenu v-model="breakKeyModel" :options="breakKeyOptions" align="right" class="shrink-0" />
                </div>
                <div class="settings-row" style="--i: 2">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.editorIndentKey") }}</p>
                    <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ t("settings.editorIndentKeyHint") }}</p>
                  </div>
                  <SelectMenu v-model="indentKeyModel" :options="indentKeyOptions" align="right" class="shrink-0" />
                </div>
                <div class="settings-row" style="--i: 3">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.editorIndentWidth") }}</p>
                    <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ t("settings.editorIndentWidthHint") }}</p>
                  </div>
                  <SelectMenu v-model="indentWidthModel" :options="indentWidthOptions" align="right" class="shrink-0" />
                </div>
              </div>
            </template>

            <!-- 个性化 -->
            <template v-else-if="active === 'personalization'">
              <h3 class="settings-heading" style="--i: 0">
                {{ t("settings.sectionPersonalization") }}
              </h3>
              <div class="settings-card">
                <!-- 软件主题:配色预览网格,点选即换 -->
                <div class="settings-block" style="--i: 0">
                  <p class="text-[13.5px] font-medium">{{ t("settings.theme") }}</p>
                  <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ t("settings.themeHint") }}</p>
                  <div class="theme-grid">
                    <button
                      v-for="th in APP_THEMES"
                      :key="th.id"
                      class="theme-card"
                      :class="{ active: themeModel === th.id }"
                      @click="themeModel = th.id"
                    >
                      <span class="theme-mini" :style="miniVars(th.dual ? DUAL_SWATCH : th.swatch)">
                        <span class="mini-side" />
                        <span class="mini-main">
                          <span class="mini-line" />
                          <span class="mini-line thin" />
                          <span class="mini-chip" />
                        </span>
                      </span>
                      <span class="theme-card-name">
                        {{ t(th.labelKey) }}
                        <AppIcon v-if="themeModel === th.id" name="check" :size="12" />
                      </span>
                    </button>
                  </div>
                </div>

                <!-- 界面字体 -->
                <div class="settings-row" style="--i: 1">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.uiFont") }}</p>
                    <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ t("settings.uiFontHint") }}</p>
                    <div v-if="uiFontModel === 'custom'" class="mt-2.5">
                      <input
                        class="input h-8 w-full max-w-[320px] text-[12.5px]"
                        type="text"
                        spellcheck="false"
                        :placeholder="t('settings.fontCustomPlaceholder')"
                        :value="app.settings.uiFontCustom ?? ''"
                        @change="onUiFontCustom"
                      />
                      <p class="mt-1 text-[11px] leading-relaxed text-ink-3">{{ t("settings.fontCustomHint") }}</p>
                    </div>
                  </div>
                  <SelectMenu v-model="uiFontModel" :options="uiFontOptions" align="right" class="shrink-0" />
                </div>

                <!-- 界面字号 -->
                <div class="settings-row" style="--i: 2">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.uiFontSize") }}</p>
                    <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ t("settings.uiFontSizeHint") }}</p>
                  </div>
                  <SelectMenu v-model="uiFontSizeModel" :options="uiFontSizeOptions" align="right" class="shrink-0" />
                </div>

                <!-- 界面字重 -->
                <div class="settings-row" style="--i: 3">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.uiFontWeight") }}</p>
                    <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ t("settings.uiFontWeightHint") }}</p>
                  </div>
                  <SelectMenu v-model="uiFontWeightModel" :options="uiFontWeightOptions" align="right" class="shrink-0" />
                </div>

                <!-- 编辑器字体 -->
                <div class="settings-row" style="--i: 4">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.editorFont") }}</p>
                    <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ t("settings.editorFontHint") }}</p>
                    <div v-if="editorFontModel === 'custom'" class="mt-2.5">
                      <input
                        class="input h-8 w-full max-w-[320px] text-[12.5px]"
                        type="text"
                        spellcheck="false"
                        :placeholder="t('settings.fontCustomPlaceholder')"
                        :value="app.settings.editorFontCustom ?? ''"
                        @change="onEditorFontCustom"
                      />
                      <p class="mt-1 text-[11px] leading-relaxed text-ink-3">{{ t("settings.fontCustomHint") }}</p>
                    </div>
                  </div>
                  <SelectMenu v-model="editorFontModel" :options="editorFontOptions" align="right" class="shrink-0" />
                </div>

                <!-- 发布成功彩带 -->
                <div class="settings-row" style="--i: 5">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.confetti") }}</p>
                    <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ t("settings.confettiHint") }}</p>
                  </div>
                  <SelectMenu
                    :model-value="app.settings.confetti ?? 'standard'"
                    :options="confettiOptions"
                    align="right"
                    class="shrink-0"
                    @update:model-value="app.setConfetti($event as ConfettiLevel)"
                  />
                </div>
              </div>
            </template>

            <!-- 数据 -->
            <template v-else-if="active === 'data'">
              <h3 class="settings-heading" style="--i: 0">
                {{ t("settings.sectionData") }}
              </h3>
              <div class="settings-card">
                <div class="settings-row" style="--i: 0">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.dataDir") }}</p>
                    <p class="mt-0.5 break-all text-[12px] leading-relaxed text-ink-3 mono">
                      {{ app.bootstrap?.appDataDir || "—" }}
                    </p>
                    <p class="mt-1 text-[11.5px] leading-relaxed text-ink-3">{{ t("settings.dataDirHint") }}</p>
                  </div>
                  <button class="btn btn-secondary shrink-0" @click="openDataDir">
                    <AppIcon name="folder" :size="14" />
                    {{ t("settings.openFolder") }}
                  </button>
                </div>

                <div class="settings-row" style="--i: 1">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.moveData") }}</p>
                    <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ t("settings.moveDataHint") }}</p>
                    <p
                      v-if="dataError"
                      class="mt-1 text-[11.5px] leading-relaxed text-danger"
                    >
                      {{ dataError }}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <button
                      v-if="app.bootstrap?.customDataDir"
                      class="btn btn-secondary"
                      :disabled="dataMoving"
                      @click="resetDataDir"
                    >
                      {{ t("settings.resetDataDir") }}
                    </button>
                    <button class="btn btn-primary" :disabled="dataMoving" @click="pickDataDir">
                      {{ t("settings.pickDataDir") }}
                    </button>
                  </div>
                </div>

                <div class="settings-row" style="--i: 2">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.repairWebview") }}</p>
                    <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ t("settings.repairWebviewHint") }}</p>
                  </div>
                  <button class="btn btn-secondary shrink-0" :disabled="repairing" @click="repairWebview">
                    {{ t("settings.repairWebview") }}
                  </button>
                </div>
              </div>
            </template>

            <!-- 关于 -->
            <template v-else>
              <h3 class="settings-heading" style="--i: 0">
                {{ t("settings.sectionAbout") }}
              </h3>
              <div class="settings-card">
                <div class="settings-row" style="--i: 0">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.version") }}</p>
                    <p class="mt-0.5 text-[12px] leading-relaxed text-ink-3">{{ app.version }}</p>
                  </div>
                  <button class="btn btn-secondary shrink-0" @click="app.setView('about')">
                    <AppIcon name="info" :size="14" />
                    {{ t("nav.about") }}
                  </button>
                </div>

                <!-- 检查更新与自动更新 -->
                <div class="settings-row" style="--i: 1">
                  <div class="min-w-0">
                    <p class="text-[13.5px] font-medium">{{ t("settings.checkUpdate") }}</p>
                    <p class="mt-0.5 truncate text-[12px] leading-relaxed" :class="hintTone">
                      {{ updateHint }}
                    </p>

                    <!-- 下载中/已暂停:更新包名 + 进度 + 速度 -->
                    <div v-if="downloading" class="mt-2 space-y-1.5">
                      <p class="truncate text-[12px] text-ink-2">{{ app.updateName }}</p>
                      <div class="h-1 w-full max-w-[240px] overflow-hidden rounded-full bg-surface-3">
                        <div
                          class="h-full rounded-full bg-accent transition-[width] duration-200 ease-(--ease-plain)"
                          :class="{ 'animate-pulse': app.updateProgress < 0 }"
                          :style="{ width: updateBar }"
                        />
                      </div>
                      <p class="text-[11.5px] text-ink-3">
                        <template v-if="app.updateTotal">
                          {{ formatSize(app.updateReceived) }} / {{ formatSize(app.updateTotal) }}
                        </template>
                        <template v-else>{{ formatSize(app.updateReceived) }}</template>
                        <template v-if="app.updatePhase === 'downloading' && speedText"> · {{ speedText }}</template>
                      </p>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <!-- 下载中:暂停 / 取消下载 -->
                    <template v-if="app.updatePhase === 'downloading'">
                      <button class="btn btn-secondary" @click="app.pauseDownload()">
                        {{ t("settings.updatePause") }}
                      </button>
                      <button class="btn btn-secondary" @click="app.cancelDownload()">
                        {{ t("settings.updateCancelDownload") }}
                      </button>
                    </template>
                    <!-- 已暂停:继续 / 取消下载 -->
                    <template v-else-if="app.updatePhase === 'paused'">
                      <button class="btn btn-primary" @click="app.resumeDownload()">
                        {{ t("settings.updateResume") }}
                      </button>
                      <button class="btn btn-secondary" @click="app.cancelDownload()">
                        {{ t("settings.updateCancelDownload") }}
                      </button>
                    </template>
                    <!-- 已就绪:重启并更新 / 放弃更新 -->
                    <template v-else-if="app.updatePhase === 'ready'">
                      <button class="btn btn-primary" :disabled="app.restartUpdating" @click="restartUpdate">
                        <AppIcon name="refresh" :size="14" />
                        {{ t("settings.updateRestart") }}
                      </button>
                      <button class="btn btn-secondary" @click="app.cancelDownload()">
                        {{ t("settings.updateCancelUpdate") }}
                      </button>
                    </template>
                    <!-- 其余阶段:下载更新与查看发布页(检测到新版时) -->
                    <template v-else>
                      <button
                        v-if="update.kind === 'available'"
                        class="btn btn-primary"
                        @click="app.updateDownload()"
                      >
                        <AppIcon name="download" :size="14" />
                        {{ t("settings.updateDownload") }}
                      </button>
                      <button
                        v-if="update.kind === 'available'"
                        class="btn btn-secondary"
                        @click="openRelease(update.url)"
                      >
                        <AppIcon name="external" :size="14" />
                        {{ t("settings.viewRelease") }}
                      </button>
                    </template>
                    <button
                      v-if="!downloading"
                      class="btn btn-secondary"
                      :disabled="update.kind === 'checking'"
                      @click="checkUpdate"
                    >
                      <AppIcon name="refresh" :size="14" :class="{ 'animate-spin': update.kind === 'checking' }" />
                      {{
                        update.kind === "checking"
                          ? t("settings.checking")
                          : update.kind === "latest"
                            ? t("settings.checkAgain")
                            : t("settings.checkUpdate")
                      }}
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
/* 分区导航项:悬停浅底,当前项实底 */
.settings-nav-item {
  position: relative;
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--color-ink-2);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-plain),
    color var(--duration-fast) var(--ease-plain);
}
.settings-nav-item:hover {
  background: var(--color-surface-2);
  color: var(--color-ink);
}
.settings-nav-item.active {
  background: var(--color-surface-3);
  color: var(--color-ink);
  font-weight: 500;
}

/* 类别页切换:进出同路径、镜像缓动,方向随导航次序变化 */
.settings-page-enter-active {
  transition:
    opacity var(--duration-slow) var(--ease-plain),
    transform var(--duration-slow) var(--ease-plain);
}
.settings-page-leave-active {
  transition:
    opacity var(--duration-base) var(--ease-plain-inverse),
    transform var(--duration-base) var(--ease-plain-inverse);
}
.settings-page-enter-from,
.settings-page-leave-to {
  opacity: 0;
}
.settings-page-enter-from[data-dir="down"],
.settings-page-leave-to[data-dir="up"] {
  transform: translateY(16px);
}
.settings-page-enter-from[data-dir="up"],
.settings-page-leave-to[data-dir="down"] {
  transform: translateY(-16px);
}

/* 页内元素次第浮现:标题先行,设置行按序跟进 */
.settings-page-enter-active .settings-heading {
  transition:
    opacity var(--duration-slow) var(--ease-plain),
    transform var(--duration-slow) var(--ease-plain);
}
.settings-page-enter-from .settings-heading {
  opacity: 0;
  transform: translateY(6px);
}
.settings-page-enter-active .settings-card {
  transition: opacity var(--duration-base) var(--ease-plain);
}
.settings-page-enter-from .settings-card {
  opacity: 0;
}
.settings-page-enter-active .settings-row {
  transition:
    opacity var(--duration-slow) var(--ease-plain),
    transform var(--duration-slow) var(--ease-plain);
  transition-delay: calc(60ms + var(--i, 0) * 45ms);
}
.settings-page-enter-from .settings-row {
  opacity: 0;
  transform: translateY(8px);
}

/* 类别标题与设置卡片 */
.settings-heading {
  margin-bottom: 10px;
  font-size: 12.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-ink-3);
}
.settings-card {
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 0 16px;
}
.settings-card + .settings-card {
  margin-top: 12px;
}

/* 设置行:标签与控件左右分布,行间细分隔线 */
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 14px 0;
}
.settings-row:first-child {
  padding-top: 15px;
}
.settings-row:last-child {
  padding-bottom: 15px;
}
.settings-row + .settings-row {
  border-top: 1px solid var(--color-line);
}

/* 纵向设置块(配色预览网格):与设置行共享分隔线节奏 */
.settings-block {
  padding: 15px 0 14px;
}
.settings-block + .settings-row,
.settings-row + .settings-block {
  border-top: 1px solid var(--color-line);
}

/* 软件主题:配色预览卡片网格 */
.theme-grid {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 8px;
}
.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--duration-base) var(--ease-plain),
    box-shadow var(--duration-base) var(--ease-plain);
}
.theme-card:hover {
  border-color: var(--color-line-strong);
}
.theme-card.active {
  border-color: var(--color-ink);
  box-shadow: inset 0 0 0 0.5px var(--color-ink);
}
.theme-card-name {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--color-ink-2);
}
.theme-card.active .theme-card-name {
  color: var(--color-ink);
  font-weight: 500;
}

/* mini 配色预览:小窗口示意(背景 / 侧栏 / 正文行 / 强调块) */
.theme-mini {
  display: flex;
  width: 100%;
  height: 40px;
  overflow: hidden;
  border: 1px solid var(--sw-line);
  border-radius: 5px;
  background: var(--sw-bg);
}
.mini-side {
  width: 26%;
  border-right: 1px solid var(--sw-line);
  background: var(--sw-panel);
}
.mini-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 4px 7px;
}
.mini-line {
  height: 2px;
  width: 78%;
  border-radius: 1px;
  background: var(--sw-text);
  opacity: 0.75;
}
.mini-line.thin {
  width: 52%;
  opacity: 0.4;
}
.mini-chip {
  height: 5px;
  width: 38%;
  border-radius: 2px;
  background: var(--sw-accent);
}
</style>
