<script setup lang="ts">
/** 移动端应用骨架:全局顶栏(桌面式品牌区 + 右侧常驻操作) + 视图容器 + 底部导航。
 *  顶栏在全部页面(含主菜单)常驻,顶部以 safe-area 避让状态栏;桌面顶栏的悬停入口
 *  (返回主菜单/查看发布状态/预览站点)在触屏上改为右侧常驻按钮,设置与关于这两个
 *  应用级入口也收进顶栏 —— 主菜单不再堆叠两枚外观一致、上下相邻的按钮(此前点
 *  「设置」会误入「关于」)。
 *  底部一行容纳站点内全部页面入口(横向滑动):边缘渐隐 + 箭头提示还有更多,当前项
 *  自动滚入视野。系统返回手势经 lib/backGesture 分发:浮层 → 视图 → 站点 → 退出。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore, type AppView } from "@/stores/app";
import { useSiteStore } from "@/stores/site";
import { useLanStore } from "@/stores/lan";
import { useBuilderStore } from "@/stores/builder";
import { usePublishStore } from "@/stores/publish";
import { usePublishTaskStore } from "@/stores/publishTask";
import { goToMenu, navigateBack, navigateView } from "@/lib/backGesture";
import AppIcon from "@/components/AppIcon.vue";
import BrandLogo from "@/components/BrandLogo.vue";
import BrandStatus from "@/components/BrandStatus.vue";
import PreviewMobile from "@/components/mobile/PreviewMobile.vue";
import StartView from "@/views/StartView.vue";
import EditorMobile from "@/views/EditorMobile.vue";
import LanView from "@/views/LanView.vue";
import AssetsView from "@/views/AssetsView.vue";
import SiteSettingsView from "@/views/SiteSettingsView.vue";
import BuildView from "@/views/BuildView.vue";
import ThemesView from "@/views/ThemesView.vue";
import PluginsView from "@/views/PluginsView.vue";
import PublishView from "@/views/PublishView.vue";
import SettingsView from "@/views/SettingsView.vue";
import AboutView from "@/views/AboutView.vue";

const { t } = useI18n();
const app = useAppStore();
const site = useSiteStore();
const lan = useLanStore();
const builder = useBuilderStore();
const publish = usePublishStore();
const task = usePublishTaskStore();

const viewMap = {
  editor: EditorMobile,
  assets: AssetsView,
  site: SiteSettingsView,
  build: BuildView,
  theme: ThemesView,
  plugins: PluginsView,
  publish: PublishView,
  settings: SettingsView,
  about: AboutView,
  lan: LanView,
} as const;

const currentView = computed(() => viewMap[app.view as keyof typeof viewMap]);

/** 底部导航:站点内页面入口,一行横向滑动;设置与关于属应用级入口,归顶栏 */
const navItems: { view: AppView; icon: string; label: string }[] = [
  { view: "editor", icon: "doc", label: "nav.editor" },
  { view: "assets", icon: "assets", label: "nav.assets" },
  { view: "site", icon: "sliders", label: "nav.site" },
  { view: "theme", icon: "palette", label: "nav.theme" },
  { view: "plugins", icon: "puzzle", label: "nav.plugins" },
  { view: "build", icon: "box", label: "nav.build" },
  { view: "publish", icon: "upload", label: "nav.publish" },
  { view: "lan", icon: "refresh", label: "nav.lan" },
];

/** 设置与关于不依赖站点:站点未打开时也可作为独立视图渲染 */
const standalone = computed(() => app.view === "settings" || app.view === "about");

/** 主菜单:站点未开且不在独立视图上(此时无路可退,「返回主菜单」置灰而非隐藏,
 *  顶栏因此不会随状态跳格) */
const atMenu = computed(() => !site.open && !standalone.value);

/** 「查看发布状态」:存在发布上下文(进行中/已完成/失败,含后台任务)时出现 */
const showPublish = computed(
  () =>
    site.open &&
    (publish.syncing ||
      task.running ||
      publish.checkingDeploy ||
      publish.deployState !== "idle" ||
      publish.result !== null ||
      publish.error !== null),
);

/** 「预览站点」:站点构建完毕(已有产物)后出现 */
const showPreview = computed(() => site.open && builder.report !== null);

/** 返回:站点打开时是「返回主菜单」(收起工作区),独立视图上只是退回上一层 */
const backLabel = computed(() => (site.open ? t("titlebar.backToMenu") : t("common.back")));

/** 返回主菜单:站点打开时收起工作区(自动保存后关闭),独立视图则弹回上一层 */
function goBack() {
  if (site.open) goToMenu();
  else navigateBack();
}

/** 查看发布状态:后台发布时先切回发起站点,再打开发布页(任务状态就地恢复) */
async function goPublish() {
  if (task.active && site.root !== task.siteRoot) {
    await site.openDir(task.siteRoot);
  }
  navigateView("publish");
}

/* ---------- 底部导航滑动余量:边缘渐隐与箭头按剩余内容显隐 ---------- */

const navEl = ref<HTMLElement | null>(null);
const navLeft = ref(false);
const navRight = ref(false);

function updateNavEdges() {
  const el = navEl.value;
  if (!el) {
    navLeft.value = false;
    navRight.value = false;
    return;
  }
  navLeft.value = el.scrollLeft > 4;
  navRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
}

/** 当前项滚入视野:从主菜单直接落到靠后的页面(或返回时)也能看到高亮项 */
function revealActive() {
  const el = navEl.value;
  if (!el) return;
  const item = el.querySelector<HTMLElement>(".tab-btn.active");
  if (!item) return;
  const target = item.offsetLeft + item.offsetWidth / 2 - el.clientWidth / 2;
  el.scrollTo({
    left: Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth)),
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
}

let navResize: ResizeObserver | null = null;

watch(
  () => site.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    updateNavEdges();
    revealActive();
    if (navEl.value && !navResize) {
      navResize = new ResizeObserver(updateNavEdges);
      navResize.observe(navEl.value);
    }
  },
);

watch(
  () => app.view,
  async () => {
    if (!site.open) return;
    await nextTick();
    revealActive();
  },
);

onMounted(updateNavEdges);
onBeforeUnmount(() => {
  navResize?.disconnect();
  navResize = null;
});
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-bg">
    <!-- 顶栏:全局常驻,桌面式品牌区(logo + 状态 + 站点名),右侧常驻操作;
         safe-area 顶部内边距避免与系统状态栏重叠 -->
    <header class="topbar">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <BrandLogo :size="22" class="shrink-0" />
        <BrandStatus class="topbar-status" />
        <template v-if="site.open && site.config">
          <span class="shrink-0 text-[calc(13px*var(--ui-font-scale))] text-ink-3">/</span>
          <span class="min-w-0 truncate text-[calc(13px*var(--ui-font-scale))] text-ink-2">{{ site.config.name }}</span>
        </template>
      </div>
      <!-- 桌面顶栏的悬停入口在触屏上常驻右侧:返回主菜单、查看发布状态、预览站点;
           设置与关于为主菜单与各页共用的应用级入口,同样常驻 -->
      <nav class="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          class="topbar-btn"
          :class="{ 'is-idle': atMenu }"
          :disabled="atMenu"
          :aria-label="backLabel"
          :title="backLabel"
          @click="goBack"
        >
          <AppIcon name="arrowLeft" :size="17" />
        </button>
        <button
          v-if="showPublish"
          type="button"
          class="topbar-btn"
          :aria-label="t('titlebar.viewPublish')"
          :title="t('titlebar.viewPublish')"
          @click="goPublish"
        >
          <AppIcon name="upload" :size="17" />
        </button>
        <button
          v-if="showPreview"
          type="button"
          class="topbar-btn"
          :aria-label="t('titlebar.previewSite')"
          :title="t('titlebar.previewSite')"
          @click="builder.openMobilePreview()"
        >
          <AppIcon name="eye" :size="17" />
        </button>
        <button
          type="button"
          class="topbar-btn"
          :class="{ current: app.view === 'settings' }"
          :aria-label="t('nav.settings')"
          :aria-current="app.view === 'settings' ? 'page' : undefined"
          :title="t('nav.settings')"
          @click="navigateView('settings')"
        >
          <AppIcon name="settings" :size="17" />
        </button>
        <button
          type="button"
          class="topbar-btn"
          :class="{ current: app.view === 'about' }"
          :aria-label="t('nav.about')"
          :aria-current="app.view === 'about' ? 'page' : undefined"
          :title="t('nav.about')"
          @click="navigateView('about')"
        >
          <AppIcon name="info" :size="17" />
        </button>
      </nav>
    </header>

    <!-- 视图容器:主菜单(StartView)仅在「站点未开且非独立视图」时呈现 -->
    <main class="relative min-h-0 flex-1">
      <StartView v-if="atMenu" class="absolute inset-0" />
      <template v-else>
        <Transition name="view" mode="out-in">
          <component :is="currentView" :key="app.view" class="absolute inset-0" />
        </Transition>
      </template>
    </main>

    <!-- 底部导航:站点打开时出现;全部入口一行排布,超出可横向滑动,
         剩余内容以边缘渐隐 + 箭头提示滑动方向 -->
    <div v-if="site.open" class="relative shrink-0">
      <nav
        ref="navEl"
        class="nav-scroll flex items-stretch border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
        @scroll.passive="updateNavEdges"
      >
        <button
          v-for="item in navItems"
          :key="item.view"
          class="tab-btn"
          :class="{ active: app.view === item.view }"
          :aria-label="t(item.label)"
          @click="navigateView(item.view)"
        >
          <span class="tab-icon">
            <AppIcon :name="item.icon" :size="21" />
            <!-- 同步页有待接收推送时的提示点 -->
            <i v-if="item.view === 'lan' && lan.incoming" class="tab-dot" />
          </span>
          <span class="tab-label">{{ t(item.label) }}</span>
        </button>
      </nav>
      <!-- 边缘渐隐:两侧按是否还有未露出的入口显隐,箭头指明还能往哪滑 -->
      <Transition name="edge">
        <i v-if="navLeft" class="nav-fade left" aria-hidden="true" />
      </Transition>
      <Transition name="edge">
        <i v-if="navRight" class="nav-fade right" aria-hidden="true" />
      </Transition>
      <Transition name="edge">
        <span v-if="navLeft" class="nav-arrow left" aria-hidden="true">
          <AppIcon name="chevronLeft" :size="14" />
        </span>
      </Transition>
      <Transition name="edge">
        <span v-if="navRight" class="nav-arrow right" aria-hidden="true">
          <AppIcon name="chevronRight" :size="14" />
        </span>
      </Transition>
    </div>

    <!-- 移动端全屏预览(构建产物,类浏览器) -->
    <PreviewMobile />
  </div>
</template>

<style scoped>
/* 顶栏:与桌面 titlebar 同一套材质(表面色 + 细分隔线)。高度 = 48 + 状态栏高度
   (border-box 下内边距算在高度里,故用 calc 补上);无遮罩机型 inset 为 0,不多留空带 */
.topbar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: calc(48px + env(safe-area-inset-top));
  flex: 0 0 auto;
  padding: 0 6px 0 12px;
  padding-top: env(safe-area-inset-top);
  border-bottom: 1px solid var(--color-line);
  background: var(--color-surface);
}

/* 顶栏状态区:窄屏收紧问候语宽度,给站点名与右侧操作留位 */
.topbar-status :deep(.status-text) {
  max-width: 12ch;
}

/* 右侧常驻操作:图标按钮,热区 34 见方(指腹友好),按下即时响应 */
.topbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-ink-2);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background-color var(--duration-fast) var(--ease-plain),
    color var(--duration-fast) var(--ease-plain);
}
.topbar-btn:active {
  background: var(--color-surface-3);
  color: var(--color-ink);
}
.topbar-btn:disabled {
  opacity: 0.3;
  pointer-events: none;
}
/* 主菜单上没有可返回的层级:按钮留位但不显示,顶栏右侧不会随着开站与否跳格 */
.topbar-btn.is-idle {
  visibility: hidden;
}
/* 当前所在页:与底栏当前项同一语言(实底 + 墨色),一眼看出位置 */
.topbar-btn.current {
  background: var(--color-surface-3);
  color: var(--color-ink);
}

/* 底部导航:横向滚动,隐藏滚动条;触屏直接滑动点按 */
.nav-scroll {
  overflow-x: auto;
  scrollbar-width: none;
}
.nav-scroll::-webkit-scrollbar {
  display: none;
}

/* 边缘渐隐与箭头:浮于导航之上,不拦截滑动 */
.nav-fade {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 40px;
  pointer-events: none;
}
.nav-fade.left {
  left: 0;
  background: linear-gradient(to right, var(--color-surface), transparent);
}
.nav-fade.right {
  right: 0;
  background: linear-gradient(to left, var(--color-surface), transparent);
}
.nav-arrow {
  position: absolute;
  top: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-top: -4px;
  border-radius: 999px;
  background: var(--color-surface-3);
  color: var(--color-ink-2);
  pointer-events: none;
}
.nav-arrow.left {
  left: 4px;
}
.nav-arrow.right {
  right: 4px;
}
.edge-enter-active,
.edge-leave-active {
  transition: opacity var(--duration-base) var(--ease-plain);
}
.edge-enter-from,
.edge-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .edge-enter-active,
  .edge-leave-active {
    transition: none;
  }
}

/* 底部导航项:图标 + 文字纵向排布,加高便于点按;按下即时缩小(apple-design:反馈在触点上,不等抬起) */
.tab-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  flex: 1 0 auto;
  min-width: 66px;
  padding: 11px 0 9px;
  border: none;
  background: transparent;
  color: var(--color-ink-3);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: color var(--duration-base) var(--ease-plain);
}
.tab-btn:active .tab-icon {
  transform: scale(0.9);
}
.tab-icon {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  transition: transform var(--duration-fast) ease-out;
}
.tab-dot {
  position: absolute;
  top: 1px;
  right: -4px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-attention);
}
.tab-label {
  font-size: calc(10px * var(--ui-font-scale));
  line-height: 1.2;
}
.tab-btn.active {
  color: var(--color-ink);
}
/* 当前项顶缘指示条 */
.tab-btn.active::before {
  content: "";
  position: absolute;
  top: 0;
  width: 28px;
  height: 2px;
  border-radius: 0 0 2px 2px;
  background: var(--color-accent);
}
</style>
