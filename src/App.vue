<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useAppStore } from "@/stores/app";
import { useSiteStore } from "@/stores/site";
import { installContextMenu } from "@/lib/contextMenu";
import TitleBar from "@/components/TitleBar.vue";
import ActivityBar from "@/components/ActivityBar.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import FeedbackHost from "@/components/FeedbackHost.vue";
import StartView from "@/views/StartView.vue";
import EditorView from "@/views/EditorView.vue";
import AssetsView from "@/views/AssetsView.vue";
import SiteSettingsView from "@/views/SiteSettingsView.vue";
import BuildView from "@/views/BuildView.vue";
import ThemesView from "@/views/ThemesView.vue";
import PublishView from "@/views/PublishView.vue";
import SettingsView from "@/views/SettingsView.vue";
import AboutView from "@/views/AboutView.vue";

const app = useAppStore();
const site = useSiteStore();

const viewMap = {
  editor: EditorView,
  assets: AssetsView,
  site: SiteSettingsView,
  build: BuildView,
  theme: ThemesView,
  publish: PublishView,
  settings: SettingsView,
} as const;

const currentView = computed(() => viewMap[app.view as keyof typeof viewMap]);

onMounted(() => {
  void app.init();
  installContextMenu();
});
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-bg">
    <TitleBar />

    <div class="relative flex min-h-0 flex-1">
      <template v-if="app.ready">
        <Transition name="view" mode="out-in">
          <!-- 关于页(站点打开与否均可访问) -->
          <AboutView v-if="app.view === 'about'" key="about" class="absolute inset-0" />

          <!-- 设置页(站点打开与否均可访问) -->
          <SettingsView v-else-if="app.view === 'settings'" key="settings" class="absolute inset-0" />

          <!-- 启动页 -->
          <StartView v-else-if="!site.open" key="start" class="absolute inset-0" />

          <!-- 工作区 -->
          <div v-else key="workspace" class="flex min-h-0 w-full">
            <ActivityBar />
            <main class="min-w-0 flex-1">
              <Transition name="view" mode="out-in">
                <component :is="currentView" :key="app.view" />
              </Transition>
            </main>
          </div>
        </Transition>
      </template>

      <!-- 启动画面 -->
      <div v-else class="flex flex-1 items-center justify-center">
        <img :src="app.isDark ? '/logo-dark.svg' : '/logo.svg'" alt="" class="h-10 w-10 opacity-70" />
      </div>
    </div>

    <FeedbackHost />
    <ContextMenu />
  </div>
</template>
