<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore } from "@/stores/app";
import { useSiteStore } from "@/stores/site";
import { useUiStore } from "@/stores/ui";
import { ipc } from "@/ipc/ipc";
import type { LanSiteBrief, SiteType } from "@/ipc/types";
import { formatSize, formatTime } from "@/lib/format";
import { isMobilePlatform } from "@/lib/platform";
import { useBackdropClose } from "@/lib/backdrop-close";
import { navigateView, useBackClose } from "@/lib/backGesture";
import AppIcon from "@/components/AppIcon.vue";

const { t } = useI18n();
const app = useAppStore();
const site = useSiteStore();
const ui = useUiStore();
const { onBackdropClick, resetBackdropClicks } = useBackdropClose();

/** 移动端(安卓/iOS):无系统目录选择,站点固定建在数据目录 sites/ 下,
 *  打开走本地站点库列表 */
const mobile = isMobilePlatform;

const showWizard = ref(false);

/** 打开新建向导:空白点击计数随开窗清零 */
function openWizard() {
  showWizard.value = true;
  resetBackdropClicks();
}

// 系统返回手势关闭向导(移动端)
useBackClose(
  () => showWizard.value,
  () => (showWizard.value = false),
);

/** 最近打开条目的站点摘要(类型与大小,异步获取;null = 获取失败) */
const siteInfos = ref<Record<string, { siteType: string; sizeBytes: number } | null>>({});

/** 移动端本地站点库(数据目录 sites/ 下的站点) */
const library = ref<LanSiteBrief[]>([]);

onMounted(() => {
  void loadSiteInfos();
  if (mobile.value) void loadLibrary();
});

async function loadLibrary() {
  try {
    library.value = await ipc.lanLocalSites();
  } catch {
    library.value = [];
  }
}

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

/** 移动端站点库路径:站点名 -> 数据目录 sites/<名称> */
function libraryPath(name: string): string {
  return `${app.bootstrap?.appDataDir ?? ""}/sites/${name}`;
}

/** 主菜单列表条目:桌面(最近打开)与移动(本地站点库)统一形态,固定状态随行 */
interface StartItem {
  key: string;
  name: string;
  path: string;
  sizeBytes: number;
  siteType: string;
  openedAt: number;
  pinned: boolean;
  isLibrary: boolean;
}

const pinnedPaths = computed(() => new Set(app.pinnedSites));

/** 桌面:最近打开(后端已按「固定在前、组内按打开时间」排好) */
const recentItems = computed<StartItem[]>(() =>
  app.recentSites.map((r) => ({
    key: r.path,
    name: r.name,
    path: r.path,
    sizeBytes: siteInfos.value[r.path]?.sizeBytes ?? 0,
    siteType: siteInfos.value[r.path]?.siteType ?? "",
    openedAt: r.openedAt,
    pinned: pinnedPaths.value.has(r.path),
    isLibrary: false,
  })),
);

/** 移动端:本地站点库,固定项置顶,其余按名称排序 */
const libraryItems = computed<StartItem[]>(() =>
  library.value
    .map((s) => ({
      key: s.name,
      name: s.name,
      path: libraryPath(s.name),
      sizeBytes: s.sizeBytes,
      siteType: s.siteType,
      openedAt: 0,
      pinned: pinnedPaths.value.has(libraryPath(s.name)),
      isLibrary: true,
    }))
    .sort((a, b) =>
      a.pinned === b.pinned ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.pinned ? -1 : 1,
    ),
);

const listItems = computed<StartItem[]>(() => (mobile.value ? libraryItems.value : recentItems.value));

/** 固定 / 取消固定:后端持久化并重排最近列表,刷新后新顺序就地生效 */
async function togglePin(item: StartItem) {
  await app.togglePinned(item.path);
}

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
  // 移动端不选目录:直接落在数据目录 sites/<名称> 下
  const dir = mobile.value ? libraryPath(wizard.name.trim()) : wizard.folder;
  if (!dir) {
    wizardError.value = t("wizard.invalidFolder");
    return;
  }
  creating.value = true;
  wizardError.value = "";
  try {
    await site.create(dir, wizard.name.trim(), wizard.description.trim() || undefined, wizard.siteType);
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

/** 移动端:打开本地站点库中的站点 */
function openLibrarySite(name: string) {
  void openRecent(libraryPath(name));
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-bg">
    <div class="mx-auto flex min-h-full w-full max-w-[480px] flex-col items-center justify-center px-6 py-16">
      <img :src="app.isDark ? '/logo-full-dark.svg' : '/logo-full.svg'" alt="Plainstruct" class="float-in h-11 select-none" draggable="false" />
      <p class="float-in mt-6 text-center text-[calc(14px*var(--ui-font-scale))] leading-relaxed text-ink-2" style="--d: 30ms">{{ t("app.tagline") }}</p>

      <div class="float-in mt-10 flex w-full gap-3" style="--d: 60ms">
        <button class="btn btn-primary h-10 flex-1" @click="openWizard">
          <AppIcon name="plus" :size="16" />
          {{ t("start.createSite") }}
        </button>
        <button v-if="!mobile" class="btn btn-secondary h-10 flex-1" @click="openSite">
          <AppIcon name="folder" :size="16" />
          {{ t("start.openSite") }}
        </button>
      </div>

      <!-- 桌面:最近打开;移动端:本地站点库(无目录选择,站点来自新建与局域网接收)。
           每行可固定 / 取消固定:固定项置顶,且不随最近列表 8 条上限被淘汰。
           列表异步加载,容器预留最小高度,避免载入瞬间把上方按钮顶离指尖 -->
      <div class="float-in mt-12 w-full" style="--d: 90ms">
        <h2 class="field-label">{{ mobile ? t("start.library") : t("start.recent") }}</h2>
        <div
          v-if="!listItems.length"
          class="grid min-h-[104px] place-items-center rounded-lg border border-dashed border-line px-4 py-6 text-center text-[calc(13px*var(--ui-font-scale))] text-ink-3"
        >
          {{ mobile ? t("start.libraryEmpty") : t("start.recentEmpty") }}
        </div>
        <TransitionGroup v-else name="list" tag="div" class="panel min-h-[104px] divide-y divide-line overflow-hidden">
          <div v-for="item in listItems" :key="item.key" class="recent-row">
            <button class="recent-item" @click="item.isLibrary ? openLibrarySite(item.name) : openRecent(item.path)">
              <AppIcon name="folder" :size="16" class="text-ink-3" />
              <span class="min-w-0 flex-1 text-left">
                <span class="block truncate text-[calc(13.5px*var(--ui-font-scale))] font-medium">{{ item.name }}</span>
                <span v-if="!item.isLibrary" class="block truncate text-[calc(11.5px*var(--ui-font-scale))] text-ink-3">{{ item.path }}</span>
                <span class="block pt-0.5 text-[calc(10.5px*var(--ui-font-scale))] text-ink-3">
                  <template v-if="item.siteType">
                    <span class="inline-flex items-center gap-1">
                      <AppIcon :name="item.siteType === 'blog' ? 'pencil' : 'doc'" :size="11" class="shrink-0" />
                      {{ item.siteType === "blog" ? t("wizard.typeBlog") : t("wizard.typeDocs") }}
                      <template v-if="item.sizeBytes"> {{ formatSize(item.sizeBytes) }}</template>
                    </span>
                  </template>
                  <span v-else-if="!item.isLibrary" class="inline-block h-2 w-24 rounded bg-surface-3 align-middle"></span>
                </span>
              </span>
              <span v-if="!item.isLibrary" class="shrink-0 text-[calc(11.5px*var(--ui-font-scale))] text-ink-3">{{ formatTime(item.openedAt) }}</span>
            </button>
            <button
              class="pin-btn"
              :class="{ pinned: item.pinned }"
              :title="item.pinned ? t('start.unpin') : t('start.pin')"
              :aria-label="item.pinned ? t('start.unpin') : t('start.pin')"
              :aria-pressed="item.pinned"
              @click="togglePin(item)"
            >
              <AppIcon name="pin" :size="15" />
            </button>
          </div>
        </TransitionGroup>
      </div>

      <!-- 桌面:设置与关于在主菜单底部(活动栏只出现在工作区内)。
           移动端这两个入口常驻于全局顶栏右侧,正文不再重复堆叠 -->
      <div v-if="!mobile" class="float-in mt-10 flex flex-col items-center gap-2" style="--d: 120ms">
        <button class="btn btn-ghost h-9 px-4 text-[calc(12.5px*var(--ui-font-scale))] text-ink-3" @click="navigateView('about')">
          <AppIcon name="info" :size="15" />
          {{ t("nav.about") }}
        </button>

        <button class="btn btn-ghost h-9 px-4 text-[calc(12.5px*var(--ui-font-scale))] text-ink-3" @click="navigateView('settings')">
          <AppIcon name="settings" :size="15" />
          {{ t("nav.settings") }}
        </button>
      </div>
    </div>

    <!-- 新建站点向导 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showWizard" class="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div class="modal-scrim absolute inset-0" @click="onBackdropClick() && (showWizard = false)" />
          <div class="modal-card panel relative max-h-[calc(100vh-80px)] w-full max-w-[440px] overflow-y-auto shadow-window" @click="resetBackdropClicks">
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
              <div v-if="!mobile">
                <label class="field-label">{{ t("wizard.folder") }}</label>
                <div class="flex gap-2">
                  <input class="input !text-[calc(12px*var(--ui-font-scale))]" type="text" readonly :value="wizard.folder" :placeholder="t('wizard.chooseFolder')" />
                  <button class="btn btn-secondary shrink-0" @click="chooseFolder">
                    {{ t("wizard.chooseFolder") }}
                  </button>
                </div>
                <p class="field-hint">{{ mobile ? t("wizard.folderHintMobile") : t("wizard.folderHint") }}</p>
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
/* 启动页元素次第浮入:非线性缓出,延迟 0/30/60/90/120ms + 180ms 动画,
   完整动画窗口不超过 300ms(reduced-motion 下直接呈现) */
.float-in {
  animation: float-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--d, 0ms);
}
@keyframes float-in {
  from {
    opacity: 0;
    transform: translateY(10px);
    /* 入场期间不可命中:延迟与淡入前半程点击不会落在「看不见的按钮」上 */
    pointer-events: none;
  }
  to {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  .float-in {
    animation: none;
  }
}

/* 列表行:打开按钮铺满 + 右缘固定按钮;悬停背景在行容器上,保证两个按钮同区高亮 */
.recent-row {
  display: flex;
  align-items: stretch;
  transition: background-color var(--duration-base) var(--ease-plain);
}
.recent-row:hover {
  background: var(--color-surface-2);
}
.recent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  padding: 12px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
}
.recent-item:active {
  opacity: 0.8;
}

/* 固定按钮:桌面悬停浮现,固定态常显(浅底墨色);触屏无悬停,始终可见 */
.pin-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  align-self: center;
  width: 32px;
  height: 32px;
  margin-right: 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-ink-3);
  cursor: pointer;
  opacity: 0;
  -webkit-tap-highlight-color: transparent;
  transition:
    opacity var(--duration-base) var(--ease-plain),
    background-color var(--duration-base) var(--ease-plain),
    color var(--duration-base) var(--ease-plain),
    transform var(--duration-fast) ease-out;
}
.recent-row:hover .pin-btn,
.pin-btn:focus-visible {
  opacity: 1;
}
.pin-btn:hover {
  color: var(--color-ink);
}
.pin-btn:active {
  transform: scale(0.9);
}
.pin-btn.pinned {
  opacity: 1;
  background: var(--color-surface-3);
  color: var(--color-ink);
}
.pin-btn:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
@media (hover: none) {
  .pin-btn {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pin-btn {
    transition: none;
  }
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
