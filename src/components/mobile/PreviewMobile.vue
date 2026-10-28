<script setup lang="ts">
/** 移动端全屏预览(类浏览器):安卓单窗口下承担桌面「独立预览窗口」的角色。
 *  覆盖层自下而上进入,顶栏提供返回与刷新;iframe 经 site:// 协议加载构建产物,
 *  协议处理器注入的触摸 shim 与桌面预览窗口一致。 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore } from "@/stores/app";
import { useBuilderStore } from "@/stores/builder";
import { useSiteStore } from "@/stores/site";
import { buildIndexUrl } from "@/lib/preview";
import { useBackClose } from "@/lib/backGesture";
import AppIcon from "@/components/AppIcon.vue";

const { t } = useI18n();
const app = useAppStore();
const builder = useBuilderStore();
const site = useSiteStore();

/** iframe 重载键:手动刷新与自动重建(previewNonce)时换 key 重挂 */
const reloadKey = ref(0);
watch(
  () => builder.previewNonce,
  () => {
    if (builder.mobilePreviewOpen) reloadKey.value++;
  },
);

const src = computed(() => buildIndexUrl(app.platform));

function close() {
  builder.closeMobilePreview();
}

useBackClose(() => builder.mobilePreviewOpen, close);
</script>

<template>
  <Teleport to="body">
    <Transition name="pm">
      <div
        v-if="builder.mobilePreviewOpen"
        class="fixed inset-0 z-[45] flex flex-col bg-bg pt-[env(safe-area-inset-top)]"
      >
        <!-- 顶栏:返回 + 站点名 + 刷新(类浏览器导航) -->
        <header class="flex h-12 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2">
          <button class="btn-icon !h-9 !w-9 shrink-0" :aria-label="t('common.back')" @click="close">
            <AppIcon name="arrowLeft" :size="18" />
          </button>
          <span class="min-w-0 flex-1 truncate text-[calc(13.5px*var(--ui-font-scale))] font-medium">
            {{ site.config?.name ?? t("build.preview") }}
          </span>
          <button class="btn-icon !h-9 !w-9 shrink-0" :aria-label="t('common.refresh')" @click="reloadKey++">
            <AppIcon name="refresh" :size="17" />
          </button>
        </header>

        <div class="min-h-0 flex-1">
          <iframe
            v-if="builder.report"
            :key="reloadKey"
            :src="src"
            class="h-full w-full border-0 bg-surface"
            sandbox="allow-same-origin allow-scripts"
            :title="t('build.preview')"
          />
          <div v-else class="flex h-full items-center justify-center px-8 text-center text-[calc(13px*var(--ui-font-scale))] leading-relaxed text-ink-3">
            {{ t("build.emptyBody") }}
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 进出同路径:自底部平移浮现,与遮罩式的模态区分开 */
.pm-enter-active,
.pm-leave-active {
  transition: transform 240ms var(--ease-plain);
}
.pm-enter-from,
.pm-leave-to {
  transform: translateY(100%);
}
@media (prefers-reduced-motion: reduce) {
  .pm-enter-active,
  .pm-leave-active {
    transition: none;
  }
}
</style>
