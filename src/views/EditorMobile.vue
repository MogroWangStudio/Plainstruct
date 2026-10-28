<script setup lang="ts">
/** 移动端编辑器:全屏编辑/预览两态 + 文件树抽屉 + 底部操作条。
 *  与桌面 EditorView 共用 editor store、FileTree、MarkdownEditor 与 DocPreview;
 *  差异:无分栏、无独立预览窗口(安卓单窗口),文件树收纳进抽屉。 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore } from "@/stores/app";
import { useEditorStore } from "@/stores/editor";
import { basename } from "@/lib/paths";
import { siteUrl } from "@/lib/preview";
import { useBackClose } from "@/lib/backGesture";
import FileTree from "@/components/FileTree.vue";
import MarkdownEditor from "@/components/MarkdownEditor.vue";
import DocPreview from "@/components/DocPreview.vue";
import AppIcon from "@/components/AppIcon.vue";

const { t } = useI18n();
const app = useAppStore();
const editor = useEditorStore();

/* ---------- 模式:移动端只有编辑 / 预览两态 ---------- */
const isPreview = computed(() => editor.mode === "preview");
function toggleMode() {
  editor.setMode(isPreview.value ? "edit" : "preview");
}

/* ---------- 选中图片的预览(与桌面一致) ---------- */
const imageUrl = computed(() =>
  editor.activeImage && app.platform !== "browser" ? siteUrl(app.platform, `content/${editor.activeImage}`) : "",
);
const imageFailed = ref(false);
watch(() => editor.activeImage, () => (imageFailed.value = false));

/* ---------- 文件树抽屉:左缘滑入,打开文档后自动收起 ---------- */
const treeOpen = ref(false);
useBackClose(
  () => treeOpen.value,
  () => (treeOpen.value = false),
);
watch(
  () => editor.activePath,
  () => (treeOpen.value = false),
);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-bg">
    <!-- 顶栏:文件名 + 保存状态 + 模式切换 -->
    <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <AppIcon :name="editor.activeImage ? 'image' : 'doc'" :size="15" class="shrink-0 text-ink-3" />
      <span class="min-w-0 flex-1 truncate text-[calc(13px*var(--ui-font-scale))] font-semibold">
        {{ editor.activeImage ? basename(editor.activeImage) : editor.activePath ? basename(editor.activePath) : t("editor.emptyTitle") }}
      </span>

      <span class="flex shrink-0 items-center gap-1 text-[calc(11px*var(--ui-font-scale))] text-ink-3">
        <template v-if="editor.saving">{{ t("editor.saving") }}</template>
        <template v-else-if="editor.autosaveCountdown !== null">
          {{ t("editor.autosaveIn", { s: (editor.autosaveCountdown / 1000).toFixed(1) }) }}
        </template>
        <template v-else-if="!editor.dirty">
          <AppIcon name="check" :size="12" />
        </template>
        <template v-else>{{ t("editor.unsaved") }}</template>
      </span>

      <!-- 编辑 / 预览 切换(仅文档态) -->
      <button
        v-if="editor.activePath"
        class="btn-icon !h-8 !w-8 shrink-0"
        :aria-label="isPreview ? t('editor.modeEdit') : t('editor.modePreview')"
        @click="toggleMode"
      >
        <AppIcon :name="isPreview ? 'code' : 'eye'" :size="16" />
      </button>
    </header>

    <!-- 内容区 -->
    <div class="relative min-h-0 flex-1">
      <!-- 图片预览 -->
      <template v-if="editor.activeImage">
        <div class="flex h-full items-center justify-center p-4">
          <img
            v-if="imageUrl && !imageFailed"
            :key="editor.activeImage"
            :src="imageUrl"
            :alt="basename(editor.activeImage)"
            class="max-h-full max-w-full rounded-md border border-line object-contain"
            @error="imageFailed = true"
          />
          <div v-else class="flex flex-col items-center gap-3 text-ink-3">
            <AppIcon name="image" :size="40" />
            <span class="text-[calc(13px*var(--ui-font-scale))]">{{ basename(editor.activeImage) }}</span>
            <span v-if="imageFailed" class="text-[calc(12px*var(--ui-font-scale))]">{{ t("editor.imageLoadFailed") }}</span>
          </div>
        </div>
      </template>

      <template v-else-if="editor.activePath">
        <MarkdownEditor v-show="!isPreview" />
        <div v-show="isPreview" class="absolute inset-0">
          <DocPreview />
        </div>
      </template>

      <!-- 空状态 -->
      <div v-else class="flex h-full flex-col items-center justify-center gap-3 px-8">
        <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-2">
          <AppIcon name="doc" :size="22" class="text-ink-3" />
        </div>
        <p class="text-center text-[calc(14px*var(--ui-font-scale))] font-semibold">{{ t("editor.emptyTitle") }}</p>
        <p class="text-center text-[calc(12.5px*var(--ui-font-scale))] leading-relaxed text-ink-3">{{ t("editor.emptyBody") }}</p>
      </div>
    </div>

    <!-- 底部操作条 -->
    <footer class="flex h-12 shrink-0 items-center gap-1 border-t border-line bg-surface px-2">
      <button
        class="btn-icon !h-9 !w-9"
        :aria-label="t('mobile.fileTree')"
        @click="treeOpen = true"
      >
        <AppIcon name="listBullet" :size="17" />
      </button>
      <button class="btn-icon !h-9 !w-9" :disabled="!editor.canUndo" :aria-label="t('editor.undo')" @click="editor.doUndo()">
        <AppIcon name="undo" :size="16" />
      </button>
      <button class="btn-icon !h-9 !w-9" :disabled="!editor.canRedo" :aria-label="t('editor.redo')" @click="editor.doRedo()">
        <AppIcon name="redo" :size="16" />
      </button>

      <span class="flex-1" />

      <!-- 未保存时给一个明确的保存按钮 -->
      <button v-if="editor.dirty && editor.activePath" class="btn btn-sm btn-primary" @click="editor.save()">
        {{ t("editor.saveNow") }}
      </button>
    </footer>

    <!-- 文件树抽屉:左缘滑入;遮罩点击收起 -->
    <Teleport to="body">
      <Transition name="drawer-scrim">
        <div v-if="treeOpen" class="fixed inset-0 z-40" @click="treeOpen = false">
          <div class="absolute inset-0 bg-scrim" />
        </div>
      </Transition>
      <Transition name="drawer">
        <aside
          v-if="treeOpen"
          class="fixed inset-y-0 left-0 z-40 flex w-[84vw] max-w-[340px] flex-col border-r border-line bg-surface"
        >
          <div class="flex min-h-0 flex-1 flex-col">
            <FileTree />
          </div>
        </aside>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* 抽屉进出同路径:遮罩淡入淡出,面板左缘平移,时长与全局一致 */
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 220ms var(--ease-plain);
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(-100%);
}
.drawer-scrim-enter-active,
.drawer-scrim-leave-active {
  transition: opacity 220ms var(--ease-plain);
}
.drawer-scrim-enter-from,
.drawer-scrim-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .drawer-enter-active,
  .drawer-leave-active,
  .drawer-scrim-enter-active,
  .drawer-scrim-leave-active {
    transition: none;
  }
}
</style>
