<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useAppStore, bootStartAnim } from "@/stores/app";
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

/** 启动动画预设对应的 logo 类名(progress/off 为静态) */
const bootAnimClass = computed(() => {
  switch (bootStartAnim.value) {
    case "fade":
      return "boot-anim-fade";
    case "pulse":
      return "boot-anim-pulse";
    default:
      return "";
  }
});

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

      <!-- 启动画面:动画预设见设置 → 个性化(启动期快照,localStorage 同步读取);
           就绪后整体淡出与主界面交叉,不再阻塞 -->
      <Transition name="boot">
        <div v-if="!app.ready" class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-bg">
          <img
            :src="app.isDark ? '/logo-dark.svg' : '/logo.svg'"
            alt=""
            class="h-10 w-10 opacity-70"
            :class="bootAnimClass"
          />
          <span v-if="bootStartAnim === 'progress'" class="boot-progress" aria-hidden="true"><i /></span>
        </div>
      </Transition>
    </div>

    <FeedbackHost />
    <ContextMenu />
  </div>
</template>

<style scoped>
/* 启动动画预设(设置 → 个性化可选择或关闭) */
/* 浮现:一次性淡入上浮,落点与静态启动画面一致 */
.boot-anim-fade {
  animation: boot-fade 480ms var(--ease-plain) both;
}
@keyframes boot-fade {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.96);
  }
  to {
    opacity: 0.7;
    transform: none;
  }
}
/* 呼吸:等待期保持生命感(启动慢时明示「仍在工作」) */
.boot-anim-pulse {
  animation: boot-pulse 1.8s ease-in-out infinite;
}
@keyframes boot-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.97);
  }
  50% {
    opacity: 0.9;
    transform: scale(1);
  }
}
/* 进度线:不定进度来回扫动(素构滑动条语言:4px 轨道) */
.boot-progress {
  width: 120px;
  height: 4px;
  border-radius: 2px;
  background: var(--color-line);
  overflow: hidden;
}
.boot-progress i {
  display: block;
  width: 40%;
  height: 100%;
  border-radius: 2px;
  background: var(--color-accent);
  animation: boot-scan 1.4s ease-in-out infinite alternate;
}
@keyframes boot-scan {
  from {
    transform: translateX(-60%);
  }
  to {
    transform: translateX(200%);
  }
}
/* 离场:整体淡出与主界面交叉,进出同路径 */
.boot-leave-active {
  transition: opacity 260ms var(--ease-plain);
}
.boot-leave-from {
  opacity: 1;
}
.boot-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .boot-anim-fade,
  .boot-anim-pulse,
  .boot-progress i {
    animation: none;
  }
  .boot-leave-active {
    transition: none;
  }
}
</style>
