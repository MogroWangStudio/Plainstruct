<script setup lang="ts">
import { computed, inject, ref, type Ref } from "vue";
import type { TreeNode } from "@/ipc/types";
import { useEditorStore } from "@/stores/editor";
import { isImageFile } from "@/lib/paths";
import AppIcon from "./AppIcon.vue";

export interface SelectClick {
  path: string;
  ctrl: boolean;
  shift: boolean;
}

/** 拖拽落点指示:before/after = 排列到该行前/后(同目录重排,跨目录移动后插入),into = 移入该文件夹,root-end = 移到根目录 */
export type DropMark =
  | { kind: "before" | "after" | "into"; path: string }
  | { kind: "root-end" }
  | null;

defineOptions({ name: "FileTreeNode" });

const props = defineProps<{
  node: TreeNode;
  depth: number;
  selectedPaths: Set<string>;
  selectMode: boolean;
  /** 锁定行:不参与拖拽移动与排序(如资产栏外部固定入口) */
  locked?: boolean;
}>();

const emit = defineEmits<{
  newDocIn: [dir: string];
  rename: [node: TreeNode];
  remove: [node: TreeNode];
  move: [src: string, destDir: string];
  reorder: [src: string, target: string, pos: "before" | "after"];
  selectClick: [click: SelectClick];
  importTo: [dir: string];
  editFolderPage: [node: TreeNode];
  editFrontMatter: [node: TreeNode];
}>();

const editor = useEditorStore();
const collapsed = inject<Ref<Set<string>>>("treeCollapsed", ref(new Set()));
const dropMark = inject<Ref<DropMark>>("treeDropMark", ref(null));
const draggingPaths = inject<Ref<Set<string> | null>>("treeDragging", ref(null));
const setDragging = inject<(src: string | null) => void>("treeSetDragging", () => {});
const dragOver = ref(false);
/** 当前悬停区域:行上/下边缘 = 移到父目录,文件夹中部 = 移入 */
const dropPos = ref<"before" | "after" | "into">("into");
let expandTimer: number | undefined;

const isDir = computed(() => props.node.type === "dir");
const isImage = computed(() => !isDir.value && isImageFile(props.node.path));
const label = computed(() => (isDir.value ? props.node.name : props.node.name.replace(/\.md$/i, "")));
const isActive = computed(
  () => !isDir.value && (editor.activePath === props.node.path || editor.activeImage === props.node.path),
);
const isCollapsed = computed(() => collapsed.value.has(props.node.path));
const isSelected = computed(() => props.selectedPaths.has(props.node.path));

/* 悬停遮罩宽度按快捷按钮个数计算:按钮不占行宽后,名称文字与按钮重叠的
   范围随按钮数变化 —— 逐按钮累加宽度,遮罩刚好盖住按钮区 */
const actionCount = computed(() => {
  if (props.selectMode) return 0;
  if (isDir.value) return 6; // 导入/新建/文件夹页/配置头/重命名/删除
  if (props.node.name.toLowerCase().endsWith(".md")) return 3; // 配置头/重命名/删除
  return 2; // 图片:重命名/删除
});
const maskWidth = computed(() => (actionCount.value ? actionCount.value * 25 + 12 : 0));

/** 行内样式:层级缩进 + 遮罩宽度(按钮数驱动;无按钮时不出遮罩) */
const rowStyle = computed(() => ({
  paddingLeft: props.depth * 14 + 4 + "px",
  ...(actionCount.value ? { "--row-mask-w": `${maskWidth.value}px` } : {}),
}));
/** 本行在拖动集合中(多选拖拽 = 全部选中项一起淡化) */
const isDragging = computed(() => !!draggingPaths.value?.has(props.node.path));
const markBefore = computed(
  () => dropMark.value?.kind === "before" && dropMark.value.path === props.node.path,
);
const markAfter = computed(
  () => dropMark.value?.kind === "after" && dropMark.value.path === props.node.path,
);

function toggle() {
  const next = new Set(collapsed.value);
  if (next.has(props.node.path)) next.delete(props.node.path);
  else next.add(props.node.path);
  collapsed.value = next;
}

function onRowClick(e: MouseEvent) {
  if (props.selectMode) {
    emit("selectClick", { path: props.node.path, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    return;
  }
  if (isDir.value) toggle();
  // 图片文件不读入编辑器:显示图片预览
  else if (isImageFile(props.node.path)) editor.openImage(props.node.path);
  else editor.openDoc(props.node);
}

function onDragStart(e: DragEvent) {
  if (props.locked) {
    e.preventDefault();
    return;
  }
  e.dataTransfer?.setData("text/plain", props.node.path);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  setDragging(props.node.path);
  dropMark.value = null;
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  // 光标处于行边缘带 = 移动到该行的父目录(显示插入线);文件夹中部 = 移入该文件夹(行高亮)
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const edge = Math.min(8, rect.height / 4);
  const y = e.clientY - rect.top;
  const pos: "before" | "after" | "into" =
    isDir.value && y >= edge && y <= rect.height - edge
      ? "into"
      : y < rect.height / 2
        ? "before"
        : "after";
  dropPos.value = pos;
  dragOver.value = pos === "into";
  dropMark.value = { kind: pos, path: props.node.path };
  // 悬停在文件夹中部时,折叠文件夹稍候自动展开,便于继续拖入更深层级
  if (pos === "into") {
    if (expandTimer === undefined) {
      expandTimer = window.setTimeout(() => {
        expandTimer = undefined;
        if (isDir.value && isCollapsed.value) {
          const next = new Set(collapsed.value);
          next.delete(props.node.path);
          collapsed.value = next;
        }
      }, 600);
    }
  } else if (expandTimer !== undefined) {
    window.clearTimeout(expandTimer);
    expandTimer = undefined;
  }
}

function endDrag(e?: DragEvent) {
  // 行内子元素间移动触发的 dragleave 不清指示,避免闪烁
  if (e && e.relatedTarget instanceof Node && e.currentTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
  dragOver.value = false;
  const mark = dropMark.value;
  if (mark && mark.kind !== "root-end" && mark.path === props.node.path) dropMark.value = null;
  clearExpandTimer();
}

function onDragEnd() {
  setDragging(null);
  dragOver.value = false;
  dropMark.value = null;
  clearExpandTimer();
}

function clearExpandTimer() {
  if (expandTimer !== undefined) {
    window.clearTimeout(expandTimer);
    expandTimer = undefined;
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  dropMark.value = null;
  const src = e.dataTransfer?.getData("text/plain");
  if (!src) return;
  // 文件夹中部 = 移入;行上/下边缘 = 排列到该行前/后(手动排序)
  if (dropPos.value === "into") {
    emit("move", src, props.node.path);
  } else {
    emit("reorder", src, props.node.path, dropPos.value);
  }
}
</script>

<template>
  <div>
    <div
      class="tree-row group flex h-[30px] cursor-default items-center gap-1 rounded-md pr-1 select-none"
      :class="{
        active: isActive,
        'drag-over': dragOver,
        'bg-surface-2': isSelected,
        'opacity-40': isDragging,
      }"
      :style="rowStyle"
      :draggable="!locked"
      :data-path="node.path"
      :title="node.name"
      @click="onRowClick"
      @dragstart="onDragStart"
      @dragend="onDragEnd"
      @dragover="onDragOver"
      @dragleave="endDrag"
      @drop="onDrop"
    >
      <!-- 拖拽落点指示线 -->
      <span v-if="markBefore" class="drop-line drop-line-top" aria-hidden="true" />
      <span v-if="markAfter" class="drop-line drop-line-bottom" aria-hidden="true" />
      <!-- 多选模式:状态复选框 -->
      <button
        v-if="selectMode"
        class="flex h-5 w-5 shrink-0 items-center justify-center rounded"
        :class="isSelected ? 'text-ink' : 'text-ink-3 opacity-60'"
        tabindex="-1"
        @click.stop="emit('selectClick', { path: node.path, ctrl: true, shift: false })"
      >
        <AppIcon :name="isSelected ? 'checkSquare' : 'square'" :size="13" />
      </button>

      <!-- 展开/折叠 -->
      <button
        v-if="isDir"
        class="btn-icon !h-5 !w-5 !text-ink-3"
        :title="isCollapsed ? '展开' : '折叠'"
        tabindex="-1"
        @click.stop="toggle"
      >
        <AppIcon :name="isCollapsed ? 'chevronRight' : 'chevronDown'" :size="13" />
      </button>
      <span v-else class="w-5" />

      <AppIcon
        :name="isDir ? 'folder' : isImage ? 'image' : 'doc'"
        :size="15"
        class="shrink-0 text-ink-3"
        :class="{ 'text-ink-2': isDir }"
      />
      <span class="min-w-0 flex-1 truncate text-[calc(13px*var(--ui-font-scale))]" :class="isActive ? 'font-medium' : ''">
        {{ label }}
      </span>

      <span v-if="!selectMode" class="row-actions">
        <button v-if="isDir" class="btn-icon !h-6 !w-6" :title="$t('tree.importToFolder')" tabindex="-1" @click.stop="emit('importTo', node.path)">
          <AppIcon name="download" :size="13" />
        </button>
        <button v-if="isDir" class="btn-icon !h-6 !w-6" :title="$t('tree.newDoc')" tabindex="-1" @click.stop="emit('newDocIn', node.path)">
          <AppIcon name="filePlus" :size="13" />
        </button>
        <button v-if="isDir" class="btn-icon !h-6 !w-6" :title="$t('tree.editFolderPage')" tabindex="-1" @click.stop="emit('editFolderPage', node)">
          <AppIcon name="file" :size="13" />
        </button>
        <!-- Markdown 文档与文件夹(经其 index.md)可直达配置头表单 -->
        <button
          v-if="isDir || (!isImage && node.name.toLowerCase().endsWith('.md'))"
          class="btn-icon !h-6 !w-6"
          :title="$t('tree.fmEdit')"
          tabindex="-1"
          @click.stop="emit('editFrontMatter', node)"
        >
          <AppIcon name="frontmatter" :size="13" />
        </button>
        <button class="btn-icon !h-6 !w-6" :title="$t('tree.rename')" tabindex="-1" @click.stop="emit('rename', node)">
          <AppIcon name="pencil" :size="13" />
        </button>
        <button class="btn-icon !h-6 !w-6 hover:!text-danger" :title="$t('tree.delete')" tabindex="-1" @click.stop="emit('remove', node)">
          <AppIcon name="trash" :size="13" />
        </button>
      </span>
    </div>

    <div v-if="isDir" class="tree-group" :data-collapsed="isCollapsed">
      <div>
        <FileTreeNode
          v-for="child in node.children"
          :key="child.path"
          :node="child"
          :depth="depth + 1"
          :selected-paths="selectedPaths"
          :select-mode="selectMode"
          @new-doc-in="(d: string) => emit('newDocIn', d)"
          @rename="(n: TreeNode) => emit('rename', n)"
          @remove="(n: TreeNode) => emit('remove', n)"
          @move="(s: string, d: string) => emit('move', s, d)"
          @reorder="(s: string, t: string, p: 'before' | 'after') => emit('reorder', s, t, p)"
          @select-click="(c: SelectClick) => emit('selectClick', c)"
          @import-to="(d: string) => emit('importTo', d)"
          @edit-folder-page="(n: TreeNode) => emit('editFolderPage', n)"
          @edit-front-matter="(n: TreeNode) => emit('editFrontMatter', n)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.tree-row {
  position: relative;
}
.tree-row:hover {
  background: var(--color-surface-2);
}
.tree-row.active {
  background: var(--color-surface-3);
}
.tree-row.drag-over {
  background: var(--color-accent-soft);
  outline: 1px dashed var(--color-line-strong);
  outline-offset: -2px;
}
/* 拖拽落点插入线:挂在行的上/下边缘,端点带圆点 */
.drop-line {
  position: absolute;
  left: 6px;
  right: 4px;
  height: 2px;
  z-index: 5;
  border-radius: 1px;
  background: var(--color-accent);
  pointer-events: none;
}
.drop-line::before {
  content: "";
  position: absolute;
  left: -3px;
  top: -2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent);
}
.drop-line-top {
  top: -1.5px;
}
.drop-line-bottom {
  bottom: -1.5px;
}
/* 文档名称贴满整行(不再为按钮区域预留空白),省略号紧贴行宽;
   悬停时快捷按钮浮出,按钮下方一层「左透明 → 右行底色」的渐变遮罩,
   避免长名称文字与按钮重叠难读 */
.row-actions {
  position: absolute;
  top: 0;
  right: 3px;
  bottom: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 1px;
  opacity: 0;
  transition: opacity var(--duration-base) var(--ease-plain);
}
.tree-row:hover .row-actions {
  opacity: 1;
}
.tree-row::after {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  /* 宽度随快捷按钮个数变化(--row-mask-w,行内样式按按钮数给出);
     渐变色标:透明在最左,纯色定在按钮区域最左侧端点(距遮罩左缘 10px,
     即首按钮左沿),纯色完整覆盖全部按钮下方,渐变只在名称侧收尾 */
  width: var(--row-mask-w, 92px);
  border-radius: inherit;
  background: linear-gradient(to right, transparent, var(--row-bg, var(--color-surface)) 10px);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-base) var(--ease-plain);
}
.tree-row:hover {
  --row-bg: var(--color-surface-2);
}
.tree-row.active {
  --row-bg: var(--color-surface-3);
}
.tree-row.drag-over {
  --row-bg: var(--color-accent-soft);
}
.tree-row:hover::after {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .row-actions,
  .tree-row::after {
    transition: none;
  }
}
</style>
