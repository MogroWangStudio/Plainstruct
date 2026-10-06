<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore } from "@/stores/app";
import { usePublishStore } from "@/stores/publish";
import { useSiteStore } from "@/stores/site";
import AppIcon from "./AppIcon.vue";
import BrandLogo from "./BrandLogo.vue";
import BrandStatus from "./BrandStatus.vue";

const { t } = useI18n();
const app = useAppStore();
const site = useSiteStore();
const publish = usePublishStore();

const maximized = ref(false);

/** 窗口控制按钮仅 Windows/Linux 需要;macOS 使用原生红绿灯(conf: titleBarStyle Overlay) */
const showWindowControls = computed(() => app.platform === "windows");
const onMac = computed(() => app.platform === "macos");
/** 悬停提示「返回主菜单」+ 手型光标:站点打开且不在设置页时可用 */
const canGoBack = computed(() => site.open && app.view !== "settings");
/** 「查看发布状态」悬停入口:存在发布上下文(进行中/已完成/失败)时出现 */
const showPublishEntry = computed(
  () =>
    canGoBack.value &&
    (publish.syncing ||
      publish.checkingDeploy ||
      publish.deployState !== "idle" ||
      publish.result !== null ||
      publish.error !== null),
);

async function winAction(action: "minimize" | "toggleMaximize" | "close") {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  if (action === "minimize") await win.minimize();
  else if (action === "toggleMaximize") {
    await win.toggleMaximize();
    maximized.value = await win.isMaximized();
  } else await win.close();
}

async function goToStart() {
  // 设置页不依赖站点(关闭站点后仍停留在设置页),这里返回主菜单会「暗中退出工作区」,
  // 故在设置页暂时禁用该入口:无悬停提示、点击无动作
  if (app.view === "settings") return;
  if (site.open) {
    await site.close();
  }
}

function goPublish() {
  app.setView("publish");
}
</script>

<template>
  <header
    class="titlebar flex h-10 shrink-0 select-none items-center gap-2 border-b border-line bg-surface pl-3 pr-2"
    data-tauri-drag-region
    @dblclick="showWindowControls && winAction('toggleMaximize')"
  >
    <!-- 品牌与路径:Windows 固定左上角;macOS 原生红绿灯占据左上角,整组移到右上角(logo 在最右,路径显示在 logo 左边) -->
    <div
      class="brand flex items-center gap-2"
      :class="[canGoBack && 'can-back cursor-pointer', onMac && 'brand-mac']"
      data-tauri-drag-region
      @click="goToStart"
    >
      <span class="brand-id flex items-center gap-2">
        <BrandLogo :size="20" :gaze-scale-x="onMac ? 0.5 : 1" class="shrink-0" />
        <!-- 「素构」二字让位给状态区:保存倒计时/保存状态、发布进度与吉祥物问候、祝福语都在这里即时呈现 -->
        <BrandStatus />
        <span v-if="site.open && site.config" class="text-[calc(13px*var(--ui-font-scale))] text-ink-3">/</span>
        <span v-if="site.open && site.config" class="text-[calc(13px*var(--ui-font-scale))] text-ink-2">{{ site.config.name }}</span>
      </span>
      <!-- 悬停提示:发布有上下文时多出「查看发布状态」,与「返回主菜单」以竖线分隔并留出空隙 -->
      <span v-if="canGoBack" class="brand-back">
        <template v-if="showPublishEntry">
          <button type="button" class="brand-link" @click.stop="goPublish">
            {{ t("titlebar.viewPublish") }}
          </button>
          <span class="brand-back-sep" aria-hidden="true">|</span>
        </template>
        <button type="button" class="brand-link" @click.stop="goToStart">
          <AppIcon name="arrowLeft" :size="14" class="brand-back-arrow" />
          <span>{{ t("titlebar.backToMenu") }}</span>
        </button>
      </span>
    </div>

    <!-- Windows:右侧窗口控制按钮 -->
    <div v-if="showWindowControls" class="ml-auto flex items-center gap-1">
      <button class="btn-icon" :title="t('titlebar.minimize')" @click="winAction('minimize')">
        <AppIcon name="minus" :size="14" />
      </button>
      <button class="btn-icon" :title="maximized ? t('titlebar.restore') : t('titlebar.maximize')" @click="winAction('toggleMaximize')">
        <AppIcon :name="maximized ? 'restore' : 'maximize'" :size="13" />
      </button>
      <button
        class="btn-icon hover:!bg-danger hover:!text-[var(--color-on-accent)]"
        :title="t('titlebar.close')"
        @click="winAction('close')"
      >
        <AppIcon name="x" :size="14" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar button {
  -webkit-app-region: no-drag;
}

/* 品牌区悬停:仅站点打开时响应 —— 默认标识滑出,「返回主菜单」以非线性缓动滑入 */
.brand {
  position: relative;
}
.brand-mac {
  margin-left: auto;
}
.brand-mac .brand-id {
  /* macOS:logo 固定在最右上角,路径显示整体排在 logo 左边 */
  flex-direction: row-reverse;
}
.brand-id {
  transition:
    opacity var(--duration-base) var(--ease-plain),
    transform var(--duration-slow) var(--ease-plain);
}
.brand.can-back:hover .brand-id {
  opacity: 0;
  transform: translateX(-10px);
}
/* macOS:内容贴右,滑出与滑入方向镜像 */
.brand-mac.can-back:hover .brand-id {
  transform: translateX(10px);
}
.brand-back {
  position: absolute;
  left: 0;
  top: 50%;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: calc(13px * var(--ui-font-scale));
  color: var(--color-ink-2);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translateY(-50%) translateX(10px);
  transition:
    opacity var(--duration-base) var(--ease-plain),
    transform var(--duration-slow) var(--ease-plain);
}
.brand-mac .brand-back {
  left: auto;
  right: 0;
  transform: translateY(-50%) translateX(-10px);
}
.brand.can-back:hover .brand-back {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}
/* 悬停项是真实按钮:与品牌区的点击(返回主菜单)解耦,竖线分隔并留出呼吸空隙 */
.brand-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 2px;
  border: none;
  background: transparent;
  color: var(--color-ink-2);
  font-size: calc(13px * var(--ui-font-scale));
  white-space: nowrap;
  cursor: pointer;
  pointer-events: auto;
  transition: color var(--duration-fast) var(--ease-plain);
}
.brand-link:hover {
  color: var(--color-ink);
}
.brand-link:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
  border-radius: 4px;
}
.brand-back-sep {
  color: var(--color-ink-3);
  opacity: 0.6;
  margin: 0 7px;
  pointer-events: none;
}
.brand-back-arrow {
  transition: transform var(--duration-slow) var(--ease-plain);
}
.brand.can-back:hover .brand-back-arrow {
  transform: translateX(-2px);
}
@media (prefers-reduced-motion: reduce) {
  .brand-id,
  .brand-back,
  .brand-back-arrow {
    transition: none;
  }
}
</style>
