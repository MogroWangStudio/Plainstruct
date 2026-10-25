<script setup lang="ts">
/** 全局发布状态药丸(右下角):后台发布进行中常驻,点开看进度与日志,
 *  可快速查看站点 / 前往发布页 / 取消发布;回到发布页或主动关闭后消失 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { usePublishTaskStore } from "@/stores/publishTask";
import { usePublishStore } from "@/stores/publish";
import { useSiteStore } from "@/stores/site";
import { useAppStore } from "@/stores/app";
import { useUiStore } from "@/stores/ui";
import { ipc } from "@/ipc/ipc";
import AppIcon from "./AppIcon.vue";

const { t } = useI18n();
const task = usePublishTaskStore();
const publish = usePublishStore();
const site = useSiteStore();
const app = useAppStore();
const ui = useUiStore();

const expanded = ref(false);

/** 已在发起站点的发布页时状态就地可见,药丸不显示 */
const visible = computed(
  () => task.active && !task.pillDismissed && !(app.view === "publish" && site.root === task.siteRoot),
);

const running = computed(() => task.phase === "building" || task.phase === "uploading");

const pct = computed(() =>
  task.progress && task.progress.total > 0 ? Math.round((task.progress.done / task.progress.total) * 100) : 0,
);

const statusText = computed(() => {
  switch (task.phase) {
    case "building":
      return t("publish.pillBuilding");
    case "uploading":
      return pct.value > 0 ? t("publish.pillUploading", { pct: pct.value }) : t("publish.pillUploadingEllipsis");
    case "done":
      return t("publish.pillDone");
    case "failed":
      return t("publish.pillFailed");
    case "cancelled":
      return t("publish.pillCancelled");
  }
  return "";
});

/** 任务站点已发布地址(有自定义域名时为域名) */
const siteUrl = computed(() => {
  const r = task.result;
  if (!r) return "";
  return r.customDomain ? `https://${r.customDomain}` : r.pagesUrl;
});

function viewSite() {
  if (!siteUrl.value) return;
  void ipc.openExternal(siteUrl.value);
}

/** 前往发起站点的发布功能页:跨站点时先切回,任务状态在发布页就地恢复 */
async function gotoPublishPage() {
  expanded.value = false;
  try {
    if (site.root !== task.siteRoot) await site.openDir(task.siteRoot);
    app.setView("publish");
  } catch (e) {
    ui.toast(`${t("publish.pillGoPageFailed")}(${ipc.errText(e)})`, "error");
  }
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
</script>

<template>
  <Transition name="pill">
    <div v-if="visible" class="pill-host">
      <Transition name="panel">
        <section v-if="expanded" class="pill-panel" aria-label="publish-task-panel">
          <header class="flex items-center justify-between gap-2">
            <p class="truncate text-[calc(13px*var(--ui-font-scale))] font-semibold text-ink">
              {{ task.siteName }}
            </p>
            <span class="shrink-0 text-[calc(12px*var(--ui-font-scale))] text-ink-3">{{ statusText }}</span>
          </header>

          <div v-if="running && task.progress" class="mt-3">
            <div class="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                class="h-full rounded-full bg-accent transition-[width] duration-200 ease-(--ease-plain)"
                :style="{ width: pct + '%' }"
              />
            </div>
            <p class="mt-1.5 text-[calc(11.5px*var(--ui-font-scale))] text-ink-3">
              {{ t("publish.progress", { done: task.progress.done, total: task.progress.total }) }}
            </p>
          </div>

          <p v-if="task.error" class="mt-3 text-[calc(12px*var(--ui-font-scale))] leading-relaxed text-danger">
            {{ task.error }}
          </p>

          <div class="pill-log mt-3" aria-label="publish-task-log">
            <p v-if="task.logs.length === 0" class="px-3 py-2 text-[calc(11.5px*var(--ui-font-scale))] text-ink-3">
              {{ t("publish.logEmpty") }}
            </p>
            <p v-for="(entry, i) in task.logs" :key="i" class="pill-log-line" :class="`is-${entry.level}`">
              <span class="shrink-0 text-ink-3">{{ formatTime(entry.time) }}</span>
              <span class="break-all">{{ entry.message }}</span>
            </p>
          </div>

          <footer class="mt-3 flex flex-wrap gap-2">
            <button v-if="task.phase === 'done' && siteUrl" class="pill-action is-primary" @click="viewSite">
              <AppIcon name="globe" :size="13" />
              {{ t("publish.viewSite") }}
            </button>
            <button v-if="running" class="pill-action" @click="publish.cancel()">
              <AppIcon name="x" :size="13" />
              {{ t("publish.cancel") }}
            </button>
            <button class="pill-action" @click="gotoPublishPage">
              <AppIcon name="arrowRight" :size="13" />
              {{ t("publish.pillGoPage") }}
            </button>
          </footer>
        </section>
      </Transition>

      <div class="pill-bar" role="status">
        <button class="pill-main" :aria-expanded="expanded" @click="expanded = !expanded">
          <span v-if="running" class="pill-spin" aria-hidden="true" />
          <AppIcon v-else-if="task.phase === 'done'" name="check" :size="14" class="shrink-0 text-ok" />
          <AppIcon v-else name="alert" :size="14" class="shrink-0" :class="task.phase === 'cancelled' ? 'text-ink-3' : 'text-danger'" />
          <span class="truncate">{{ statusText }}</span>
          <span class="hidden truncate text-ink-3 sm:inline">· {{ task.siteName }}</span>
        </button>
        <button class="pill-close" :title="t('publish.pillClose')" @click.stop="task.dismissPill()">
          <AppIcon name="x" :size="13" />
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* 宿主固定在右下角;面板从药丸上方弹出,锚定右缘(来源与去向同一方向) */
.pill-host {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.pill-bar {
  display: flex;
  align-items: stretch;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-surface) 82%, transparent);
  backdrop-filter: blur(20px) saturate(160%);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);
}

.pill-main {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 320px;
  padding: 8px 6px 8px 14px;
  border: 0;
  background: transparent;
  color: var(--color-ink);
  font-size: calc(12.5px * var(--ui-font-scale));
  font-weight: 550;
  cursor: pointer;
  transition: transform 100ms ease-out;
}
.pill-main:active {
  transform: scale(0.97);
}
.pill-main:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.pill-close {
  display: grid;
  place-items: center;
  width: 28px;
  border: 0;
  background: transparent;
  color: var(--color-ink-3);
  cursor: pointer;
  transition: color 140ms ease, transform 100ms ease-out;
}
.pill-close:hover {
  color: var(--color-ink);
}
.pill-close:active {
  transform: scale(0.9);
}
.pill-close:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

/* 进行中:两段式加减速旋转的小加载弧 */
.pill-spin {
  flex-shrink: 0;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--color-ink-3) 35%, transparent);
  border-top-color: var(--color-accent);
  animation: pill-spin 1100ms cubic-bezier(0.45, 0, 0.55, 1) infinite;
}
@keyframes pill-spin {
  0% {
    transform: rotate(0deg);
  }
  55% {
    transform: rotate(305deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.pill-panel {
  width: 320px;
  padding: 12px;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-surface) 88%, transparent);
  backdrop-filter: blur(24px) saturate(160%);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.18);
  transform-origin: bottom right;
}

.pill-log {
  max-height: 150px;
  overflow-y: auto;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface-2);
  padding: 6px 0;
}
.pill-log-line {
  display: flex;
  gap: 8px;
  padding: 1px 10px;
  font-family: var(--font-mono);
  font-size: calc(11px * var(--ui-font-scale));
  line-height: 1.7;
}
.pill-log-line.is-success {
  font-weight: 600;
}
.pill-log-line.is-error {
  color: var(--color-danger);
}

.pill-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink-2);
  font-size: calc(12px * var(--ui-font-scale));
  cursor: pointer;
  transition: transform 100ms ease-out, background-color 140ms ease, color 140ms ease, border-color 140ms ease;
}
.pill-action:hover {
  color: var(--color-ink);
  border-color: var(--color-accent);
}
.pill-action:active {
  transform: scale(0.96);
}
.pill-action:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
.pill-action.is-primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-on-accent);
}

/* 进出场同路径:右下角上浮淡入,离场沿原路返回 */
.pill-enter-active,
.pill-leave-active {
  transition: opacity 220ms var(--ease-plain), transform 260ms var(--ease-pop);
}
.pill-enter-from,
.pill-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

.panel-enter-active,
.panel-leave-active {
  transition: opacity 160ms var(--ease-plain), transform 200ms var(--ease-pop);
}
.panel-enter-from,
.panel-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(4px);
}

@media (prefers-reduced-motion: reduce) {
  .pill-spin {
    animation-duration: 2.4s;
  }
  .pill-enter-active,
  .pill-leave-active,
  .panel-enter-active,
  .panel-leave-active {
    transition: opacity 200ms ease;
  }
  .pill-enter-from,
  .pill-leave-to,
  .panel-enter-from,
  .panel-leave-to {
    transform: none;
  }
  .pill-main:active,
  .pill-close:active,
  .pill-action:active {
    transform: none;
  }
}
</style>
