<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useBuilderStore } from "@/stores/builder";
import { useSiteStore } from "@/stores/site";
import { ipc } from "@/ipc/ipc";
import { formatSize } from "@/lib/format";
import AppIcon from "@/components/AppIcon.vue";
import PreviewFrame from "@/components/PreviewFrame.vue";

const { t } = useI18n();
const builder = useBuilderStore();
const site = useSiteStore();

function openOutput() {
  void ipc.openPath(`${site.root}/build`);
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-bg">
    <!-- 头部 -->
    <header class="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
      <div class="min-w-0">
        <h1 class="text-[calc(15px*var(--ui-font-scale))] font-semibold leading-tight">{{ t("build.title") }}</h1>
        <p class="truncate text-[calc(12px*var(--ui-font-scale))] text-ink-3">{{ t("build.subtitle") }}</p>
      </div>
      <div class="ml-auto flex items-center gap-3">
        <label class="flex cursor-pointer items-center gap-2 text-[calc(12.5px*var(--ui-font-scale))] text-ink-2">
          <input v-model="builder.autoRebuild" type="checkbox" class="checkbox-input" @change="builder.setAutoRebuild(builder.autoRebuild)" />
          {{ t("build.autoRebuild") }}
        </label>
        <button
          class="btn btn-primary"
          :disabled="builder.building"
          @click="builder.build()"
        >
          <AppIcon name="box" :size="15" />
          {{ builder.building ? t("build.building") : builder.report ? t("build.rebuild") : t("build.build") }}
        </button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- 侧栏:构建报告 -->
      <aside class="flex w-[280px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
        <div class="flex min-h-0 flex-1 flex-col gap-5 p-5">
          <template v-if="builder.report">
            <div>
              <h2 class="field-label">{{ t("build.report") }}</h2>
              <div class="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <span class="text-[calc(13px*var(--ui-font-scale))] text-ink-2">
                  <span class="text-[calc(17px*var(--ui-font-scale))] font-bold text-ink">{{ builder.report.pages }}</span>
                  {{ t("build.statPages") }}
                </span>
                <span class="text-[calc(13px*var(--ui-font-scale))] text-ink-2">
                  <span class="text-[calc(17px*var(--ui-font-scale))] font-bold text-ink">{{ builder.report.assets }}</span>
                  {{ t("build.statAssets") }}
                </span>
                <span class="text-[calc(13px*var(--ui-font-scale))] text-ink-2">
                  <span class="text-[calc(17px*var(--ui-font-scale))] font-bold text-ink">{{ builder.report.durationMs }}</span>
                  {{ t("build.statMs") }}
                </span>
                <span class="text-[calc(13px*var(--ui-font-scale))] text-ink-2">
                  <span class="text-[calc(17px*var(--ui-font-scale))] font-bold text-ink">{{ formatSize(builder.report.totalSize) }}</span>
                  {{ t("build.statSize") }}
                </span>
              </div>
            </div>

            <div>
              <h2 class="field-label">
                {{ builder.report.warnings.length ? t("build.warnings", { n: builder.report.warnings.length }) : t("build.noWarnings") }}
              </h2>
              <div v-if="builder.report.warnings.length" class="flex flex-col gap-2">
                <div
                  v-for="(w, i) in builder.report.warnings.slice(0, 50)"
                  :key="i"
                  class="rounded-lg border border-line bg-bg px-3 py-2"
                >
                  <p class="mono truncate text-[calc(11.5px*var(--ui-font-scale))] text-ink-2">{{ w.source }}</p>
                  <p class="mono truncate text-[calc(11.5px*var(--ui-font-scale))] text-danger">
                    {{ w.link }} - {{ w.message === "missing" ? t("build.warningMissing") : w.message }}
                  </p>
                </div>
              </div>
            </div>
          </template>

          <div v-else-if="builder.error" class="rounded-lg border border-line bg-danger-soft px-3 py-3 text-[calc(12.5px*var(--ui-font-scale))] leading-relaxed text-danger">
            {{ builder.error }}
          </div>

          <div v-else class="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <div class="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-2">
              <AppIcon name="box" :size="20" class="text-ink-3" />
            </div>
            <p class="text-[calc(13.5px*var(--ui-font-scale))] font-semibold">{{ t("build.emptyTitle") }}</p>
            <p class="text-[calc(12.5px*var(--ui-font-scale))] leading-relaxed text-ink-3">{{ t("build.emptyBody") }}</p>
          </div>

          <!-- 输出操作:与「重新构建」同规格的大按钮 -->
          <div class="mt-auto flex flex-col gap-2 border-t border-line pt-4">
            <!-- 独立窗口加载的是构建产物,未构建时不可用 -->
            <button v-if="ipc.inTauri" class="btn btn-secondary w-full" :disabled="!builder.report" @click="builder.openOrRefreshPreviewWindow">
              <AppIcon name="window" :size="15" />
              {{ t("build.openWindow") }}
            </button>
            <button class="btn btn-secondary w-full" @click="openOutput">
              <AppIcon name="external" :size="15" />
              {{ t("build.openFolder") }}
            </button>
          </div>
        </div>
      </aside>

      <!-- 预览 -->
      <section class="flex min-w-0 flex-1 flex-col">
        <div class="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
          <span class="text-[calc(12.5px*var(--ui-font-scale))] font-semibold text-ink-2">{{ t("build.preview") }}</span>
          <span class="text-[calc(11.5px*var(--ui-font-scale))] text-ink-3">{{ t("build.previewHint") }}</span>
        </div>
        <div class="min-h-0 flex-1">
          <PreviewFrame v-if="builder.report" />
          <div v-else class="flex h-full items-center justify-center text-[calc(13px*var(--ui-font-scale))] text-ink-3">
            {{ t("build.emptyBody") }}
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
