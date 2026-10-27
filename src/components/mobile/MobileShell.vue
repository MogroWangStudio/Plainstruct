<script setup lang="ts">
/** 移动端应用骨架:顶栏(返回 + 当前位置) + 视图容器 + 底部导航。
 *  底部五项:编辑 / 资产 / 同步 / 发布 / 更多;站点设置、主题、插件、构建、
 *  应用设置与关于收纳进「更多」面板 —— 全部桌面视图在移动端都有对应入口。 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore, type AppView } from "@/stores/app";
import { useSiteStore } from "@/stores/site";
import { useEditorStore } from "@/stores/editor";
import { useLanStore } from "@/stores/lan";
import AppIcon from "@/components/AppIcon.vue";
import BrandLogo from "@/components/BrandLogo.vue";
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

/** 更多面板 */
const moreOpen = ref(false);
const moreItems: { view: AppView; icon: string; label: string }[] = [
  { view: "site", icon: "sliders", label: "nav.site" },
  { view: "theme", icon: "palette", label: "nav.theme" },
  { view: "plugins", icon: "puzzle", label: "nav.plugins" },
  { view: "build", icon: "box", label: "nav.build" },
  { view: "settings", icon: "settings", label: "nav.settings" },
  { view: "about", icon: "info", label: "nav.about" },
];

const bottomItems: { view: AppView; icon: string; label: string }[] = [
  { view: "editor", icon: "doc", label: "nav.editor" },
  { view: "assets", icon: "assets", label: "nav.assets" },
  { view: "lan", icon: "refresh", label: "nav.lan" },
  { view: "publish", icon: "upload", label: "nav.publish" },
];

/** 当前视图的顶栏标题:编辑器显示站点名,其余显示页面名 */
const topTitle = computed(() => {
  if (!site.open) return "";
  if (app.view === "editor") return site.config?.name ?? "";
  const all = [...bottomItems, ...moreItems];
  return t(all.find((i) => i.view === app.view)?.label ?? "nav.editor");
});

/** 非编辑器视图顶栏提供返回:回到编辑器(移动端的主页面) */
function goBack() {
  if (app.view !== "editor" && site.open) app.setView("editor");
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-bg">
    <!-- 顶栏:站点打开时显示位置与返回;未开站点时 StartView 自带品牌区 -->
    <header
      v-if="site.open"
      class="flex min-h-12 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 pt-[env(safe-area-inset-top)]"
    >
      <button
        v-if="app.view !== 'editor'"
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

    <!-- 视图容器 -->
    <main class="relative min-h-0 flex-1">
      <StartView v-if="!site.open" class="absolute inset-0" />
      <template v-else>
        <Transition name="view" mode="out-in">
          <component :is="currentView" :key="app.view" class="absolute inset-0" />
        </Transition>
      </template>
    </main>

    <!-- 底部导航(站点打开时出现) -->
    <nav
      v-if="site.open"
      class="flex shrink-0 items-stretch border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <button
        v-for="item in bottomItems"
        :key="item.view"
        class="tab-btn flex-1"
        :class="{ active: app.view === item.view }"
        :aria-label="t(item.label)"
        @click="app.setView(item.view)"
      >
        <span class="tab-icon">
          <AppIcon :name="item.icon" :size="20" />
          <!-- 同步页有待接收推送时的提示点 -->
          <i v-if="item.view === 'lan' && lan.incoming" class="tab-dot" />
        </span>
        <span class="tab-label">{{ t(item.label) }}</span>
      </button>
      <button class="tab-btn flex-1" :class="{ active: moreOpen }" :aria-label="t('mobile.more')" @click="moreOpen = true">
        <span class="tab-icon">
          <AppIcon :name="moreOpen ? 'x' : 'more'" :size="20" />
        </span>
        <span class="tab-label">{{ t("mobile.more") }}</span>
      </button>
    </nav>

    <!-- 更多面板:底部弹出,列出其余页面 -->
    <Teleport to="body">
      <Transition name="sheet-scrim">
        <div v-if="moreOpen" class="fixed inset-0 z-40" @click="moreOpen = false">
          <div class="absolute inset-0 bg-scrim" />
        </div>
      </Transition>
      <Transition name="sheet">
        <div
          v-if="moreOpen"
          class="fixed inset-x-0 bottom-0 z-40 rounded-t-xl border-t border-line bg-surface pb-[max(env(safe-area-inset-bottom),12px)] shadow-window"
        >
          <div class="mx-auto mt-2.5 h-1 w-9 rounded-full bg-line-strong" aria-hidden="true" />
          <div class="grid grid-cols-4 gap-1 px-3 pb-1 pt-3">
            <button
              v-for="item in moreItems"
              :key="item.view"
              class="more-item"
              :class="{ active: app.view === item.view }"
              @click="
                app.setView(item.view);
                moreOpen = false;
              "
            >
              <AppIcon :name="item.icon" :size="19" />
              <span>{{ t(item.label) }}</span>
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* 底部导航项:图标 + 文字纵向排布;按下即时缩小(apple-design:反馈在触点上,不等抬起) */
.tab-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 7px 0 5px;
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
  height: 24px;
  transition: transform var(--duration-fast) ease-out;
}
.tab-dot {
  position: absolute;
  top: 1px;
  right: -3px;
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

/* 更多面板九宫格项 */
.more-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 4px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--color-ink-2);
  font-size: calc(11px * var(--ui-font-scale));
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--duration-base) var(--ease-plain);
}
.more-item:active {
  background: var(--color-surface-2);
}
.more-item.active {
  color: var(--color-ink);
}

/* 更多面板:进出同路径,自底部平移(遮罩同步淡入) */
.sheet-enter-active,
.sheet-leave-active {
  transition: transform 220ms var(--ease-plain);
}
.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(100%);
}
.sheet-scrim-enter-active,
.sheet-scrim-leave-active {
  transition: opacity 220ms var(--ease-plain);
}
.sheet-scrim-enter-from,
.sheet-scrim-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active,
  .sheet-leave-active,
  .sheet-scrim-enter-active,
  .sheet-scrim-leave-active {
    transition: none;
  }
}
</style>
