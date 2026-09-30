<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore } from "@/stores/app";
import { useSiteStore } from "@/stores/site";
import { useUiStore } from "@/stores/ui";
import { ipc } from "@/ipc/ipc";
import type { SiteType } from "@/ipc/types";
import { formatSize, formatTime } from "@/lib/format";
import AppIcon from "@/components/AppIcon.vue";

const { t } = useI18n();
const app = useAppStore();
const site = useSiteStore();
const ui = useUiStore();

/** 最近打开条目的站点摘要(类型与大小,异步获取;null = 获取失败) */
const siteInfos = ref<Record<string, { siteType: string; sizeBytes: number } | null>>({});

onMounted(() => {
  void loadSiteInfos();
});

async function loadSiteInfos() {
  await Promise.all(
    app.recentSites.map(async (r) => {
      try {
        const info = await ipc.getSiteInfo(r.path);
        siteInfos.value = { ...siteInfos.value, [r.path]: info };
      } catch {
        siteInfos.value = { ...siteInfos.value, [r.path]: null };
      }
    }),
  );
}

function siteMetaText(path: string): string {
  const info = siteInfos.value[path];
  if (!info) return "";
  const type = info.siteType === "blog" ? t("wizard.typeBlog") : t("wizard.typeDocs");
  return `${type} · ${formatSize(info.sizeBytes) || "0 B"}`;
}

const showWizard = ref(false);
const wizard = reactive({ name: "", description: "", folder: "", siteType: "docs" as SiteType });
const wizardError = ref("");
const creating = ref(false);

async function chooseFolder() {
  const dir = await ipc.pickDirectory();
  if (dir) wizard.folder = dir;
}

async function createSite() {
  if (!wizard.name.trim()) {
    wizardError.value = t("wizard.invalidName");
    return;
  }
  if (!wizard.folder) {
    wizardError.value = t("wizard.invalidFolder");
    return;
  }
  creating.value = true;
  wizardError.value = "";
  try {
    await site.create(wizard.folder, wizard.name.trim(), wizard.description.trim() || undefined, wizard.siteType);
    showWizard.value = false;
  } catch (e) {
    const msg = ipc.errText(e);
    wizardError.value = msg.includes("occupied") ? t("wizard.occupied") : msg;
  } finally {
    creating.value = false;
  }
}

async function openSite() {
  const dir = await ipc.pickDirectory();
  if (!dir) return;
  try {
    await site.openDir(dir);
  } catch (e) {
    const msg = ipc.errText(e);
    ui.toast(msg.includes("not-a-site") ? t("start.notASite") : t("start.openFailed", { msg }), "error");
  }
}

async function openRecent(path: string) {
  try {
    await site.openDir(path);
  } catch {
    ui.toast(t("start.openFailed", { msg: t("start.notASite") }), "error");
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-bg">
    <div class="mx-auto flex min-h-full w-full max-w-[480px] flex-col items-center justify-center px-6 py-16">
      <img :src="app.isDark ? '/logo-full-dark.svg' : '/logo-full.svg'" alt="Plainstruct" class="h-11 select-none" draggable="false" />
      <p class="mt-6 text-center text-[calc(14px*var(--ui-font-scale))] leading-relaxed text-ink-2">{{ t("app.tagline") }}</p>

      <div class="mt-10 flex w-full gap-3">
        <button class="btn btn-primary h-10 flex-1" @click="showWizard = true">
          <AppIcon name="plus" :size="16" />
          {{ t("start.createSite") }}
        </button>
        <button class="btn btn-secondary h-10 flex-1" @click="openSite">
          <AppIcon name="folder" :size="16" />
          {{ t("start.openSite") }}
        </button>
      </div>

      <div class="mt-12 w-full">
        <h2 class="field-label">{{ t("start.recent") }}</h2>
        <div v-if="!app.recentSites.length" class="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[calc(13px*var(--ui-font-scale))] text-ink-3">
          {{ t("start.recentEmpty") }}
        </div>
        <TransitionGroup v-else name="list" tag="div" class="panel divide-y divide-line overflow-hidden">
          <button
            v-for="item in app.recentSites"
            :key="item.path"
            class="recent-item"
            @click="openRecent(item.path)"
          >
            <AppIcon name="folder" :size="16" class="text-ink-3" />
            <span class="min-w-0 flex-1 text-left">
              <span class="block truncate text-[calc(13.5px*var(--ui-font-scale))] font-medium">{{ item.name }}</span>
              <span class="block truncate text-[calc(11.5px*var(--ui-font-scale))] text-ink-3">{{ item.path }}</span>
              <span class="block pt-0.5 text-[calc(10.5px*var(--ui-font-scale))] text-ink-3">
                <template v-if="siteMetaText(item.path)">{{ siteMetaText(item.path) }}</template>
                <span v-else class="inline-block h-2 w-24 rounded bg-surface-3 align-middle"></span>
              </span>
            </span>
            <span class="shrink-0 text-[calc(11.5px*var(--ui-font-scale))] text-ink-3">{{ formatTime(item.openedAt) }}</span>
          </button>
        </TransitionGroup>
      </div>

      <button class="btn btn-ghost mt-10 h-9 px-4 text-[calc(12.5px*var(--ui-font-scale))] text-ink-3" @click="app.setView('about')">
        <AppIcon name="info" :size="15" />
        {{ t("nav.about") }}
      </button>

      <button class="btn btn-ghost mt-2 h-9 px-4 text-[calc(12.5px*var(--ui-font-scale))] text-ink-3" @click="app.setView('settings')">
        <AppIcon name="settings" :size="15" />
        {{ t("nav.settings") }}
      </button>
    </div>

    <!-- 新建站点向导 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showWizard" class="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div class="absolute inset-0 bg-[var(--color-scrim)]" @click="showWizard = false" />
          <div class="modal-card panel relative max-h-[calc(100vh-80px)] w-full max-w-[440px] overflow-y-auto shadow-window">
            <header class="px-6 pb-2 pt-5">
              <h2 class="text-[calc(16px*var(--ui-font-scale))] font-semibold">{{ t("wizard.title") }}</h2>
            </header>
            <div class="flex flex-col gap-4 px-6 pb-2">
              <div>
                <label class="field-label">{{ t("wizard.siteType") }}</label>
                <div class="type-cards">
                  <button
                    type="button"
                    class="type-card"
                    :class="{ active: wizard.siteType === 'docs' }"
                    @click="wizard.siteType = 'docs'"
                  >
                    <span class="type-preview" aria-hidden="true">
                      <span class="tp-side">
                        <i /><i /><i /><i />
                      </span>
                      <span class="tp-main">
                        <i class="tp-title" /><i /><i /><i class="tp-short" />
                      </span>
                    </span>
                    <span class="type-card-body">
                      <AppIcon name="doc" :size="17" class="shrink-0" />
                      <span class="min-w-0">
                        <span class="block text-[calc(13px*var(--ui-font-scale))] font-medium">{{ t("wizard.typeDocs") }}</span>
                        <span class="block text-[calc(11.5px*var(--ui-font-scale))] leading-snug text-ink-3">{{ t("wizard.typeDocsHint") }}</span>
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="type-card"
                    :class="{ active: wizard.siteType === 'blog' }"
                    @click="wizard.siteType = 'blog'"
                  >
                    <span class="type-preview" aria-hidden="true">
                      <span class="tp-nav"><i /></span>
                      <span class="tp-feed">
                        <i /><i /><i />
                      </span>
                    </span>
                    <span class="type-card-body">
                      <AppIcon name="pencil" :size="17" class="shrink-0" />
                      <span class="min-w-0">
                        <span class="block text-[calc(13px*var(--ui-font-scale))] font-medium">{{ t("wizard.typeBlog") }}</span>
                        <span class="block text-[calc(11.5px*var(--ui-font-scale))] leading-snug text-ink-3">{{ t("wizard.typeBlogHint") }}</span>
                      </span>
                    </span>
                  </button>
                </div>
              </div>
              <div>
                <label class="field-label">{{ t("wizard.name") }}</label>
                <input
                  v-model="wizard.name"
                  class="input"
                  type="text"
                  :placeholder="t('wizard.namePlaceholder')"
                  autofocus
                  @keydown.enter="createSite"
                />
              </div>
              <div>
                <label class="field-label">{{ t("wizard.description") }}</label>
                <input
                  v-model="wizard.description"
                  class="input"
                  type="text"
                  :placeholder="t('wizard.descriptionPlaceholder')"
                  @keydown.enter="createSite"
                />
              </div>
              <div>
                <label class="field-label">{{ t("wizard.folder") }}</label>
                <div class="flex gap-2">
                  <input class="input !text-[calc(12px*var(--ui-font-scale))]" type="text" readonly :value="wizard.folder" :placeholder="t('wizard.chooseFolder')" />
                  <button class="btn btn-secondary shrink-0" @click="chooseFolder">
                    {{ t("wizard.chooseFolder") }}
                  </button>
                </div>
                <p class="field-hint">{{ t("wizard.folderHint") }}</p>
              </div>
              <p v-if="wizardError" class="text-[calc(12.5px*var(--ui-font-scale))] text-danger">{{ wizardError }}</p>
            </div>
            <footer class="mt-4 flex justify-end gap-2 border-t border-line px-6 py-4">
              <button class="btn btn-secondary" @click="showWizard = false">{{ t("common.cancel") }}</button>
              <button class="btn btn-primary" :disabled="creating" @click="createSite">
                {{ creating ? t("common.loading") : t("wizard.create") }}
              </button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.recent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background-color var(--duration-base) var(--ease-plain);
}
.recent-item:hover {
  background: var(--color-surface-2);
}
.recent-item:active {
  opacity: 0.8;
}

/* 站点类型选择:两枚等宽卡片,顶部各带对应站点类型的迷你界面示意(常显)。
   来回切换时选中态以非线性缓动平滑过渡(缩放/透明度/描边/阴影,可随时反向),
   预览框随选中态同步提亮 */
.type-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.type-card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 10px;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  color: var(--color-ink-2);
  text-align: left;
  cursor: pointer;
  transform: scale(0.97);
  opacity: 0.72;
  transition:
    transform var(--duration-slow) var(--ease-plain),
    opacity var(--duration-slow) var(--ease-plain),
    border-color var(--duration-base) var(--ease-plain),
    background-color var(--duration-base) var(--ease-plain),
    color var(--duration-base) var(--ease-plain),
    box-shadow var(--duration-slow) var(--ease-plain);
}
.type-card:hover {
  transform: scale(0.985);
  opacity: 0.88;
}
.type-card:active {
  transform: scale(0.955);
}
.type-card.active {
  transform: scale(1);
  opacity: 1;
  border-color: var(--color-accent);
  background: var(--color-surface-2);
  color: var(--color-ink);
  box-shadow: var(--shadow-popover);
}
.type-card:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
.type-card-body {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 0 2px 2px;
}

/* 迷你界面示意(常显):文档站 = 侧栏目录 + 正文;博客站 = 顶栏导航 + 文章流 */
.type-preview {
  display: flex;
  gap: 6px;
  height: 72px;
  padding: 8px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-bg);
  overflow: hidden;
  transition: border-color var(--duration-base) var(--ease-plain);
}
.type-card.active .type-preview {
  border-color: var(--color-line-strong);
}
.type-preview i {
  display: block;
  border-radius: 3px;
  background: var(--color-surface-3);
}
/* 文档站:侧栏目录 + 标题与正文行 */
.tp-side {
  width: 24%;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.tp-side i {
  height: 6px;
}
.tp-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.tp-main i {
  height: 6px;
}
.tp-main .tp-title {
  height: 10px;
  background: var(--color-line-strong);
}
.tp-main .tp-short {
  width: 62%;
}
/* 博客站:顶栏导航 + 文章卡片流 */
.tp-nav {
  height: 10px;
}
.tp-nav i {
  width: 55%;
  height: 100%;
  background: var(--color-line-strong);
}
.tp-feed {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.tp-feed i {
  flex: 1;
  min-height: 0;
}

@media (prefers-reduced-motion: reduce) {
  .type-card,
  .type-card:hover,
  .type-card:active,
  .type-card.active {
    transform: none;
    transition: none;
  }
}

</style>
