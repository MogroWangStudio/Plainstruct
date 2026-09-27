<script setup lang="ts">
/** 内容工作区:文件树 + 编辑器 + 实时预览(可拖动分栏,比例同步滚动);选中图片文件时显示图片预览 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore } from "@/stores/app";
import { useEditorStore, type EditorMode } from "@/stores/editor";
import { basename } from "@/lib/paths";
import { siteUrl } from "@/lib/preview";
import FileTree from "@/components/FileTree.vue";
import MarkdownEditor from "@/components/MarkdownEditor.vue";
import DocPreview from "@/components/DocPreview.vue";
import AppIcon from "@/components/AppIcon.vue";

const { t } = useI18n();
const editor = useEditorStore();
const app = useAppStore();

/** 选中图片的预览地址;浏览器 mock 无 site:// 资源服务,降级为文件名占位 */
const imageUrl = computed(() =>
  editor.activeImage && app.platform !== "browser"
    ? siteUrl(app.platform, `content/${editor.activeImage}`)
    : "",
);

const editorRef = ref<InstanceType<typeof MarkdownEditor>>();
const previewRef = ref<InstanceType<typeof DocPreview>>();
const splitHost = ref<HTMLElement>();
const ratio = ref(0.52);
let syncing = false;

const modes: { value: EditorMode; icon: string; label: string }[] = [
  { value: "edit", icon: "code", label: "editor.modeEdit" },
  { value: "split", icon: "columns", label: "editor.modeSplit" },
  { value: "preview", icon: "eye", label: "editor.modePreview" },
];

/* ---------- 分栏拖动(Pointer Events + capture) ---------- */

function onDividerDown(e: PointerEvent) {
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onDividerMove(e: PointerEvent) {
  if (!(e.buttons & 1) || !splitHost.value) return;
  const rect = splitHost.value.getBoundingClientRect();
  const next = (e.clientX - rect.left) / rect.width;
  ratio.value = Math.min(0.8, Math.max(0.2, next));
}

/* ---------- 比例滚动同步(编辑器 -> 预览) ---------- */

function onEditorScroll() {
  if (syncing || editor.mode === "edit") return;
  const scroller = editorRef.value?.scroller();
  if (!scroller) return;
  const max = scroller.scrollHeight - scroller.clientHeight;
  if (max <= 0) return;
  syncing = true;
  previewRef.value?.scrollToRatio(scroller.scrollTop / max);
  requestAnimationFrame(() => (syncing = false));
}

onMounted(() => {
  editorRef.value?.scroller()?.addEventListener("scroll", onEditorScroll, { passive: true });
});

onBeforeUnmount(() => {
  editorRef.value?.scroller()?.removeEventListener("scroll", onEditorScroll);
});
</script>

<template>
  <div class="flex h-full min-h-0">
    <!-- 文件树侧栏 -->
    <aside class="w-[240px] shrink-0 border-r border-line bg-surface">
      <FileTree />
    </aside>

    <!-- 主区 -->
    <section class="flex min-w-0 flex-1 flex-col bg-bg">
      <!-- 图片预览(内容树选中图片文件时,不读入编辑器) -->
      <template v-if="editor.activeImage">
        <header class="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <AppIcon name="image" :size="15" class="shrink-0 text-ink-3" />
          <span class="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{{ basename(editor.activeImage) }}</span>
          <span class="mono shrink-0 text-[12px] text-ink-3">{{ editor.activeImage }}</span>
        </header>
        <div class="flex min-h-0 flex-1 items-center justify-center p-8">
          <img
            v-if="imageUrl"
            :src="imageUrl"
            :alt="basename(editor.activeImage)"
            class="max-h-full max-w-full rounded-md border border-line object-contain"
          />
          <span v-else class="text-[13px] text-ink-3">{{ basename(editor.activeImage) }}</span>
        </div>
      </template>

      <template v-else-if="editor.activePath">
        <!-- 文档工具条 -->
        <header class="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <span class="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{{ editor.docTitle }}</span>

          <span class="flex items-center gap-1.5 text-[12px] text-ink-3">
            <template v-if="editor.saving">{{ t("editor.saving") }}</template>
            <template v-else-if="!editor.dirty">
              <AppIcon name="check" :size="13" class="text-ink-3" />
              {{ t("editor.saved") }}
            </template>
            <template v-else>
              {{ t("editor.unsaved") }}
              <button class="btn btn-sm btn-secondary" @click="editor.save()">{{ t("editor.saveNow") }}</button>
            </template>
          </span>

          <!-- 显示模式 -->
          <div class="flex items-center rounded-md border border-line bg-bg p-0.5">
            <button
              v-for="m in modes"
              :key="m.value"
              class="mode-btn"
              :class="{ active: editor.mode === m.value }"
              :title="t(m.label)"
              @click="editor.setMode(m.value)"
            >
              <AppIcon :name="m.icon" :size="15" />
            </button>
          </div>
        </header>

        <!-- 编辑 / 预览 -->
        <div ref="splitHost" class="flex min-h-0 flex-1">
          <div
            v-show="editor.mode !== 'preview'"
            class="min-w-0 flex-1 bg-surface"
            :style="editor.mode === 'split' ? { flex: `0 0 ${ratio * 100}%` } : undefined"
          >
            <MarkdownEditor ref="editorRef" />
          </div>

          <div
            v-if="editor.mode === 'split'"
            class="divider w-px cursor-col-resize bg-line"
            @pointerdown="onDividerDown"
            @pointermove="onDividerMove"
          />

          <div v-show="editor.mode !== 'edit'" class="min-w-0 flex-1">
            <DocPreview ref="previewRef" />
          </div>
        </div>
      </template>

      <!-- 空状态 -->
      <div v-else class="flex flex-1 flex-col items-center justify-center gap-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-2">
          <AppIcon name="doc" :size="22" class="text-ink-3" />
        </div>
        <p class="text-[15px] font-semibold">{{ t("editor.emptyTitle") }}</p>
        <p class="text-[13px] text-ink-3">{{ t("editor.emptyBody") }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.mode-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-ink-3);
  cursor: pointer;
  transition:
    background-color var(--duration-base) var(--ease-plain),
    color var(--duration-base) var(--ease-plain);
}
.mode-btn:hover {
  color: var(--color-ink);
}
.mode-btn.active {
  background: var(--color-surface);
  color: var(--color-ink);
  box-shadow: 0 0 0 1px var(--color-line);
}

.divider {
  position: relative;
  flex-shrink: 0;
}
.divider::before {
  content: "";
  position: absolute;
  inset: 0 -3px;
}
.divider:hover {
  background: var(--color-line-strong);
}
</style>
