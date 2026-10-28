<script setup lang="ts">
/** 移动端应用骨架:顶栏(返回 + 当前位置) + 视图容器 + 可滚动底部导航。
 *  底部一行容纳全部页面入口(横向滑动),底栏高度加大便于点按;
 *  设置与关于不依赖站点(主菜单即可进入),站点未打开时同样可渲染。
 *  系统返回手势经 lib/backGesture 分发:浮层 → 视图 → 退出应用。 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore, type AppView } from "@/stores/app";
import { useSiteStore } from "@/stores/site";
import { useEditorStore } from "@/stores/editor";
import { useLanStore } from "@/stores/lan";
import { navigateBack, navigateView } from "@/lib/backGesture";
import AppIcon from "@/components/AppIcon.vue";
import BrandLogo from "@/components/BrandLogo.vue";
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
const editor = useEditorStore();
const lan = useLanStore();

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

/** 顶栏标题:编辑器显示站点名,其余显示页面名 */
const topTitle = computed(() => {
  if (app.view === "editor") return site.config?.name ?? "";
  return t(navItems.find((i) => i.view === app.view)?.label ?? "nav.editor");
});

/** 顶栏返回:回到编辑器(站点打开时)或主菜单(未打开时) */
function goBack() {
  navigateBack();
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-bg">
    <!-- 顶栏:独立视图与站点工作区显示位置与返回;主菜单(StartView)自带品牌区 -->
    <header
      v-if="site.open || standalone"
      class="flex min-h-12 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 pt-[env(safe-area-inset-top)]"
    >
      <button
        v-if="!site.open || app.view !== 'editor'"
        class="btn-icon !h-9 !w-9 shrink-0"
        :aria-label="t('common.back')"
        @click="goBack"
      >
        <AppIcon name="arrowLeft" :size="18" />
      </button>
      <BrandLogo v-else :size="22" class="ml-1.5 shrink-0" />
      <span class="min-w-0 flex-1 truncate text-[calc(14px*var(--ui-font-scale))] font-semibold">{{ topTitle }}</span>
      <!-- 编辑器内未保存提示点:与编辑器内保存状态互补,全局可见 -->
      <span
        v-if="app.view === 'editor' && editor.dirty"
        class="mr-2 h-1.5 w-1.5 shrink-0 rounded-full bg-attention"
        :title="t('editor.unsaved')"
      />
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

    <!-- 底部导航:站点打开时出现;全部入口一行排布,超出可横向滑动 -->
    <nav
      v-if="site.open"
      class="nav-scroll flex shrink-0 items-stretch border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
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

    <!-- 移动端全屏预览(构建产物,类浏览器) -->
    <PreviewMobile />
  </div>
</template>

<style scoped>
/* 底部导航:横向滚动,隐藏滚动条;触屏直接滑动点按 */
.nav-scroll {
  overflow-x: auto;
  scrollbar-width: none;
}
.nav-scroll::-webkit-scrollbar {
  display: none;
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
