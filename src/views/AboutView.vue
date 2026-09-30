<script setup lang="ts">
/** 关于页 -- 品牌、版本、简介与技术栈,站点打开与否均可访问 */
import { useI18n } from "vue-i18n";
import { useAppStore } from "@/stores/app";
import { ipc } from "@/ipc/ipc";
import AppIcon from "@/components/AppIcon.vue";

const { t } = useI18n();
const app = useAppStore();

const STUDIO_SITE = "https://www.mogrowangstudio.top";

function goBack() {
  app.setView("editor");
}

function openStudioSite() {
  void ipc.openExternal(STUDIO_SITE);
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-bg">
    <div class="mx-auto flex min-h-full w-full max-w-[520px] flex-col items-center justify-center px-6 py-16">
      <img :src="app.isDark ? '/logo-full-dark.svg' : '/logo-full.svg'" alt="Plainstruct" class="h-12 select-none" draggable="false" />

      <div class="mt-8 flex items-baseline gap-3">
        <h1 class="text-[calc(22px*var(--ui-font-scale))] font-bold tracking-tight">素构 Plainstruct</h1>
        <span class="rounded border border-line bg-surface px-1.5 py-0.5 text-[calc(11px*var(--ui-font-scale))] font-medium text-ink-2 mono">
          v{{ app.version }}
        </span>
      </div>
      <p class="mt-3 text-center text-[calc(14px*var(--ui-font-scale))] leading-relaxed text-ink-2">{{ t("app.tagline") }}</p>

      <!-- 三个板块:简介 / 架构 / 工作室 -->
      <div class="mt-10 w-full">
        <!-- 简介 -->
        <div class="rounded-xl border border-line bg-surface p-6">
          <h2 class="field-label">{{ t("about.sectionIntro") }}</h2>
          <p class="whitespace-pre-line text-[calc(13.5px*var(--ui-font-scale))] leading-relaxed text-ink-2">{{ t("about.description") }}</p>
        </div>

        <!-- 架构 -->
        <div class="mt-3 rounded-xl border border-line bg-surface p-6">
          <h2 class="field-label">{{ t("about.sectionArchitecture") }}</h2>
          <p class="text-[calc(13px*var(--ui-font-scale))] leading-relaxed text-ink-2">Vue 3 · TypeScript · Tauri 2</p>
        </div>

        <!-- 工作室:署名字标可点击前往官网 + 版权 -->
        <div class="mt-3 rounded-xl border border-line bg-surface p-6">
          <h2 class="field-label">{{ t("about.sectionStudio") }}</h2>
          <a
            href="https://www.mogrowangstudio.top"
            class="studio-link group relative mx-auto mt-5 block w-fit"
            @click.prevent="openStudioSite"
          >
            <img
              src="/studio-logo.svg"
              alt="MogroWang Studio"
              class="h-6 select-none transition-[filter,opacity] duration-200 ease-(--ease-plain) group-hover:opacity-70 group-hover:blur-[3px] group-focus-visible:opacity-70 group-focus-visible:blur-[3px]"
              draggable="false"
            />
            <span class="studio-hint">{{ t("about.studioHint") }}</span>
          </a>
          <p class="mt-5 border-t border-line pt-4 text-center text-[calc(12.5px*var(--ui-font-scale))] text-ink-3">
            © 2026 MogroWang Studio
          </p>
        </div>
      </div>

      <button class="btn btn-secondary mt-10 h-10 px-6" @click="goBack">
        <AppIcon name="arrowLeft" :size="16" />
        {{ t("common.back") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 悬停引导文字:覆盖在模糊的 logo 上,居中不换行;
   字色用墨色 token —— 浅色主题即近黑,深色主题自动反色保持可读 */
.studio-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(12px * var(--ui-font-scale));
  font-weight: 500;
  color: var(--color-ink);
  white-space: nowrap;
  opacity: 0;
  transition: opacity var(--duration-base) var(--ease-plain);
  pointer-events: none;
}
.studio-link:hover .studio-hint,
.studio-link:focus-visible .studio-hint {
  opacity: 1;
}
.studio-link:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 4px;
  border-radius: 4px;
}
</style>
