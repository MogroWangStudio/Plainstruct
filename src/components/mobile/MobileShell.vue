<script setup lang="ts">
/** 移动端应用骨架:全局顶栏(桌面式品牌区 + 右侧常驻操作) + 视图容器 + 底部导航。
 *  顶栏始终存在(含主菜单),顶部以 safe-area 避让状态栏;桌面顶栏的悬停入口
 *  (返回主菜单/查看发布状态/预览站点)在触屏上改为常驻右侧按钮。
 *  底部一行容纳全部页面入口(横向滑动),滑动余量以边缘渐隐 + 箭头提示。
 *  系统返回手势经 lib/backGesture 分发:浮层 → 视图 → 退出应用。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore, type AppView } from "@/stores/app";
import { useSiteStore } from "@/stores/site";
import { useLanStore } from "@/stores/lan";
import { useBuilderStore } from "@/stores/builder";
import { usePublishStore } from "@/stores/publish";
import { usePublishTaskStore } from "@/stores/publishTask";
import { navigateBack, navigateView } from "@/lib/backGesture";
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

/** 底部导航:全部入口,一行横向滑动 */
const navItems: { view: AppView; icon: string; label: string }[] = [
  { view: "editor", icon: "doc", label: "nav.editor" },
  { view: "assets", icon: "assets", label: "nav.assets" },
  { view: "site", icon: "sliders", label: "nav.site" },
  { view: "theme", icon: "palette", label: "nav.theme" },
  { view: "plugins", icon: "puzzle", label: "nav.plugins" },
  { view: "build", icon: "box", label: "nav.build" },
  { view: "publish", icon: "upload", label: "nav.publish" },
  { view: "lan", icon: "refresh", label: "nav.lan" },
  { view: "settings", icon: "settings", label: "nav.settings" },
  { view: "about", icon: "info", label: "nav.about" },
];

/** 设置与关于不依赖站点:站点未打开时也可作为独立视图渲染 */
const standalone = computed(() => app.view === "settings" || app.view === "about");

/** 「返回主菜单」常驻右侧:离开主菜单后始终可用(含站点未开的独立视图) */
const showBack = computed(() => site.open || standalone.value);

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

/** 返回主菜单:站点打开时收尾工作区(自动保存后关闭),独立视图则弹回主菜单 */
async function goBackToMenu() {
  if (site.open) {
    await site.close();
    app.setView("editor");
    return;
  }
  navigateBack();
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

let navResize: ResizeObserver | null = null;

watch(
  () => site.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    updateNavEdges();
    if (navEl.value && !navResize) {
      navResize = new ResizeObserver(updateNavEdges);
      navResize.observe(navEl.value);
    }
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
    <header
      class="flex min-h-12 shrink-0 items-center gap-1.5 border-b border-line bg-surface pl-3 pr-1.5 pt-[env(safe-area-inset-top)]"
    >
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <BrandLogo :size="22" class="shrink-0" />
        <BrandStatus class="topbar-status" />
        <template v-if="site.open && site.config">
          <span class="shrink-0 text-[calc(13px*var(--ui-font-scale))] text-ink-3">/</span>
          <span class="min-w-0 truncate text-[calc(13px*var(--ui-font-scale))] text-ink-2">{{ site.config.name }}</span>
        </template>
      </div>
      <!-- 桌面顶栏的悬停入口在触屏上常驻:返回主菜单、查看发布状态、预览站点 -->
      <nav class="flex shrink-0 items-center">
        <button v-if="showBack" class="topbar-link" @click="goBackToMenu">
          <AppIcon name="arrowLeft" :size="14" />
          <span>{{ t("titlebar.backToMenu") }}</span>
        </button>
        <button v-if="showPublish" class="topbar-link" @click="goPublish">
          {{ t("titlebar.viewPublish") }}
        </button>
        <button v-if="showPreview" class="topbar-link" @click="builder.openMobilePreview()">
          {{ t("titlebar.previewSite") }}
        </button>
      </nav>
    </header>

    <!-- 视图容器:主菜单(StartView)仅在「站点未开且非独立视图」时呈现 -->
    <main class="relative min-h-0 flex-1">
      <StartView v-if="!site.open && !standalone" class="absolute inset-0" />
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
      <!-- 边缘渐隐:左缘在右滑后出现,右缘 + 箭头提示还有更多入口 -->
      <Transition name="edge">
        <i v-if="navLeft" class="nav-fade left" aria-hidden="true" />
      </Transition>
      <Transition name="edge">
        <i v-if="navRight" class="nav-fade right" aria-hidden="true" />
      </Transition>
      <Transition name="edge">
        <span v-if="navRight" class="nav-more" aria-hidden="true">
          <AppIcon name="chevronRight" :size="15" />
        </span>
      </Transition>
    </div>

    <!-- 移动端全屏预览(构建产物,类浏览器) -->
    <PreviewMobile />
  </div>
</template>

<style scoped>
/* 顶栏状态区:窄屏收紧问候语宽度,给站点名与右侧操作留位 */
.topbar-status :deep(.status-text) {
  max-width: 11ch;
}

/* 右侧常驻操作:与桌面 brand-link 同源的轻量文字按钮,触屏热区加高 */
.topbar-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding: 0 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--color-ink-2);
  font-size: calc(12.5px * var(--ui-font-scale));
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background-color var(--duration-fast) var(--ease-plain),
    color var(--duration-fast) var(--ease-plain);
}
.topbar-link:active {
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
  width: 44px;
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
.nav-more {
  position: absolute;
  top: 16px;
  right: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--color-surface-3);
  color: var(--color-ink-3);
  pointer-events: none;
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
