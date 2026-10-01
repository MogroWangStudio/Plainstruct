<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useAppStore } from "@/stores/app";
import { useSiteStore } from "@/stores/site";
import { useEditorStore } from "@/stores/editor";
import { ipc } from "@/ipc/ipc";
import { Events, listen } from "@/ipc/events";
import { useI18n } from "vue-i18n";
import { installContextMenu } from "@/lib/contextMenu";
import TitleBar from "@/components/TitleBar.vue";
import ActivityBar from "@/components/ActivityBar.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import FeedbackHost from "@/components/FeedbackHost.vue";
import Modal from "@/components/Modal.vue";
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
const editor = useEditorStore();
const { t } = useI18n();

/* ---------- 关窗守卫:有未保存修改时先询问(保存并关闭 / 不保存 / 取消) ----------
 * 非 macOS 下,Rust 侧拦截 CloseRequested 后转发本事件;无未保存修改时直接销毁窗口,
 * 有则弹确认。macOS 关窗只是隐藏窗口(无数据丢失),Rust 侧不转发。 */
const closeAskOpen = ref(false);
let closeAsked = false;

async function installCloseGuard() {
  if (!ipc.inTauri) return;
  await listen<void>(Events.CloseRequested, () => {
    if (app.platform === "macos" || closeAsked) return;
    if (!editor.dirty) {
      void destroyWindow();
      return;
    }
    closeAsked = true;
    closeAskOpen.value = true;
  });
}

async function destroyWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().destroy();
}

async function closeSaveAndExit() {
  await editor.save();
  await destroyWindow();
}

async function closeDiscard() {
  await destroyWindow();
}

function closeCancel() {
  closeAskOpen.value = false;
  closeAsked = false;
}

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
  void installCloseGuard();
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

      <!-- 启动画面:就绪后整体淡出与主界面交叉,不再阻塞 -->
      <Transition name="boot">
        <div v-if="!app.ready" class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-bg">
          <img :src="app.isDark ? '/logo-dark.svg' : '/logo.svg'" alt="" class="h-10 w-10 opacity-70" />
        </div>
      </Transition>
    </div>

    <FeedbackHost />
    <ContextMenu />

    <!-- 关窗守卫:有未保存修改时的三选确认 -->
    <Modal v-if="closeAskOpen" :title="t('editor.closeDirtyTitle')" :width="380" @cancel="closeCancel">
      <p class="text-[calc(13.5px*var(--ui-font-scale))] leading-relaxed text-ink-2">
        {{ t("editor.closeDirtyBody", { doc: editor.activePath ?? "" }) }}
      </p>
      <template #footer>
        <button class="btn btn-secondary" @click="closeCancel">{{ t("common.cancel") }}</button>
        <button class="btn btn-secondary" @click="closeDiscard">{{ t("editor.closeDiscard") }}</button>
        <button class="btn btn-primary" @click="closeSaveAndExit">{{ t("editor.closeSave") }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
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
  .boot-leave-active {
    transition: none;
  }
}
</style>
