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
        <h1 class="text-[22px] font-bold tracking-tight">素构 Plainstruct</h1>
        <span class="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-2 mono">
          v{{ app.version }}
        </span>
      </div>
      <p class="mt-3 text-center text-[14px] leading-relaxed text-ink-2">{{ t("app.tagline") }}</p>

      <div class="mt-10 w-full rounded-xl border border-line bg-surface p-6">
        <p class="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{{ t("about.description") }}</p>

        <!-- 工作室署名字标(固定双色):悬停模糊并浮现官网引导文字,点击前往官网 -->
        <a
          href="https://www.mogrowangstudio.top"
          class="studio-link group relative mx-auto mt-7 block"
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

        <div class="mt-6 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-5 text-[12.5px] text-ink-3">
          <span>Vue 3 · TypeScript · Tauri 2</span>
          <span>© 2026 MogroWang Studio</span>
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
  font-size: 12px;
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
