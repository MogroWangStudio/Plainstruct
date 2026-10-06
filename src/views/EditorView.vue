<script setup lang="ts">
/** 内容工作区:文件树 + 编辑器 + 实时预览(可拖动分栏,比例同步滚动);选中图片文件时显示图片预览 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore } from "@/stores/app";
import { useBuilderStore } from "@/stores/builder";
import { useEditorStore, type EditorMode } from "@/stores/editor";
import { basename } from "@/lib/paths";
import { siteUrl } from "@/lib/preview";
import { toCssPx } from "@/lib/scale";
import { ipc } from "@/ipc/ipc";
import FileTree from "@/components/FileTree.vue";
import MarkdownEditor from "@/components/MarkdownEditor.vue";
import DocPreview from "@/components/DocPreview.vue";
import AppIcon from "@/components/AppIcon.vue";

const { t } = useI18n();
const editor = useEditorStore();
const app = useAppStore();
const builder = useBuilderStore();

/** 独立预览窗口:未开则先构建再打开;已开则切到独立窗口(不关闭 —— 关窗只能由用户主动进行) */
async function togglePreviewWindow() {
  if (builder.previewWindowOpen) {
    await builder.focusPreviewWindow();
    return;
  }
  await builder.build();
  await builder.openOrRefreshPreviewWindow();
}

/** 选中图片的预览地址;浏览器 mock 无 site:// 资源服务,降级为文件名占位 */
const imageUrl = computed(() =>
  editor.activeImage && app.platform !== "browser"
    ? siteUrl(app.platform, `content/${editor.activeImage}`)
    : "",
);

/** 图片加载失败时渲染受控占位,避免 Chromium 的失败占位文本盖满窗口 */
const imageFailed = ref(false);
watch(() => editor.activeImage, () => (imageFailed.value = false));

const editorRef = ref<InstanceType<typeof MarkdownEditor>>();
const previewRef = ref<InstanceType<typeof DocPreview>>();
const splitHost = ref<HTMLElement>();
const hostRef = ref<HTMLElement>();
const ratio = ref(0.52);
let syncing = false;

const modes: { value: EditorMode; icon: string; label: string }[] = [
  { value: "edit", icon: "code", label: "editor.modeEdit" },
  { value: "split", icon: "columns", label: "editor.modeSplit" },
  { value: "preview", icon: "eye", label: "editor.modePreview" },
];

/* ---------- 分栏拖动(Pointer Events + capture;拖动中才跟踪,避免选字划过时误触) ---------- */

let splitDragging = false;

function onDividerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  splitDragging = true;
}

function onDividerMove(e: PointerEvent) {
  if (!splitDragging) return;
  if (!(e.buttons & 1)) {
    splitDragging = false;
    return;
  }
  if (!splitHost.value) return;
  const rect = splitHost.value.getBoundingClientRect();
  const next = (e.clientX - rect.left) / rect.width;
  ratio.value = Math.min(0.8, Math.max(0.2, next));
}

function onDividerUp() {
  splitDragging = false;
}

/* ---------- 文件树宽度可拖(右缘分隔线) ---------- */

const treeW = ref(240);
/** 拖动中标记:只有在本分隔线上按下后才跟踪移动,避免编辑器内拖动选字划过分隔线时误触 */
let treeDragging = false;

function onTreeDividerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  treeDragging = true;
}

function onTreeDividerMove(e: PointerEvent) {
  if (!treeDragging || e.pointerId === undefined) return;
  if (!(e.buttons & 1)) {
    treeDragging = false;
    return;
  }
  const host = hostRef.value;
  if (!host) return;
  // 以工作区主容器左缘(活动栏右侧)为原点,分隔线始终贴合指针,不受活动栏宽度影响
  const rect = host.getBoundingClientRect();
  treeW.value = Math.min(360, Math.max(180, toCssPx(e.clientX - rect.left)));
}

function onTreeDividerUp() {
  treeDragging = false;
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
  // 同步独立预览窗口开关状态(应用启动时窗口可能已开着)
  if (ipc.inTauri) void builder.syncPreviewWindowOpen();
});

onBeforeUnmount(() => {
  editorRef.value?.scroller()?.removeEventListener("scroll", onEditorScroll);
});
</script>

<template>
  <div ref="hostRef" class="flex h-full min-h-0">
    <!-- 文件树侧栏 -->
    <!-- 文件树侧栏:宽度可拖(右缘分隔线,180–360px) -->
    <aside class="shrink-0 bg-surface" :style="{ width: treeW + 'px' }">
      <FileTree />
    </aside>
    <div
      class="relative w-px shrink-0 cursor-col-resize bg-line after:absolute after:-left-1 after:-right-1 after:inset-y-0 after:content-['']"
      @pointerdown="onTreeDividerDown"
      @pointermove="onTreeDividerMove"
      @pointerup="onTreeDividerUp"
      @pointercancel="onTreeDividerUp"
      @lostpointercapture="onTreeDividerUp"
    />

    <!-- 主区 -->
    <section class="flex min-w-0 flex-1 flex-col bg-bg">
      <!-- 图片预览(内容树选中图片文件时,不读入编辑器) -->
      <template v-if="editor.activeImage">
        <header class="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <AppIcon name="image" :size="15" class="shrink-0 text-ink-3" />
          <span class="min-w-0 flex-1 truncate text-[calc(13.5px*var(--ui-font-scale))] font-semibold">{{ basename(editor.activeImage) }}</span>
          <span class="mono shrink-0 text-[calc(12px*var(--ui-font-scale))] text-ink-3">{{ editor.activeImage }}</span>
        </header>
        <div class="flex min-h-0 flex-1 items-center justify-center p-8">
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
        <!-- 文档工具条:标题栏显示文件名(含 .md 后缀),文档标题由配置头与页面承载 -->
        <header class="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <span class="min-w-0 flex-1 truncate text-[calc(13.5px*var(--ui-font-scale))] font-semibold">{{ basename(editor.activePath) }}</span>

          <span class="flex items-center gap-1.5 text-[calc(12px*var(--ui-font-scale))] text-ink-3">
            <template v-if="editor.saving">{{ t("editor.saving") }}</template>
            <!-- 自动保存倒计时:输入后延迟落盘的剩余时间,随设置可调 -->
            <template v-else-if="editor.autosaveCountdown !== null">
              {{ t("editor.autosaveIn", { s: (editor.autosaveCountdown / 1000).toFixed(1) }) }}
            </template>
            <template v-else-if="!editor.dirty">
              <AppIcon name="check" :size="13" class="text-ink-3" />
              {{ t("editor.saved") }}
            </template>
            <template v-else>
              {{ t("editor.unsaved") }}
              <button class="btn btn-sm btn-secondary save-urge" @click="editor.save()">{{ t("editor.saveNow") }}</button>
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

          <!-- 独立预览窗口:未开时点击构建并打开,已开时点击切到独立窗口(不关闭;关闭只能由用户主动关窗) -->
          <button
            class="mode-btn preview-toggle"
            :class="{ active: builder.previewWindowOpen }"
            :title="t('editor.previewWindow')"
            @click="togglePreviewWindow"
          >
            <AppIcon name="window" :size="15" />
          </button>
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
            @pointerup="onDividerUp"
            @pointercancel="onDividerUp"
            @lostpointercapture="onDividerUp"
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
        <p class="text-[calc(15px*var(--ui-font-scale))] font-semibold">{{ t("editor.emptyTitle") }}</p>
        <p class="text-[calc(13px*var(--ui-font-scale))] text-ink-3">{{ t("editor.emptyBody") }}</p>
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
/* 独立预览窗口开关:窗口打开期间保持点亮,提示当前处于外窗预览 */
.preview-toggle.is-on,
.preview-toggle.active {
  background: var(--color-accent-soft);
  color: var(--color-ink);
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

/* 「立即保存」提醒:蓝色边框呼吸闪烁,把视线从未保存文字引到按钮上
   (浅/深主题共用一个注意色;减弱动态时保持常亮蓝边不闪烁) */
.save-urge {
  border: 1.5px solid var(--color-attention);
  background: color-mix(in srgb, var(--color-attention) 6%, var(--color-surface));
  animation: urge-blink 1.2s ease-in-out infinite;
}
@keyframes urge-blink {
  0%,
  100% {
    border-color: var(--color-attention);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-attention) 24%, transparent);
  }
  50% {
    border-color: color-mix(in srgb, var(--color-attention) 30%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-attention) 14%, transparent);
  }
}
@media (prefers-reduced-motion: reduce) {
  .save-urge {
    animation: none;
  }
}
</style>
