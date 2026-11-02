<script setup lang="ts">
/** 关于页(桌面) -- 品牌与版本信息,内容统一由 AboutPanel 承载;
 *  移动端不再进入此页,设置页「关于」分区直接内嵌同一份内容 */
import { useI18n } from "vue-i18n";
import { useAppStore } from "@/stores/app";
import AppIcon from "@/components/AppIcon.vue";
import AboutPanel from "@/components/AboutPanel.vue";

const { t } = useI18n();
const app = useAppStore();

function goBack() {
  app.setView("editor");
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-bg">
    <div class="mx-auto flex min-h-full w-full max-w-[520px] flex-col items-center justify-center px-6 py-16">
      <AboutPanel />

      <button class="btn btn-secondary mt-10 h-10 px-6" @click="goBack">
        <AppIcon name="arrowLeft" :size="16" />
        {{ t("common.back") }}
      </button>
    </div>
  </div>
</template>
