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
  /** 固定资源区(images)子项:不参与拖拽移动与排序 */
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
      :style="{ paddingLeft: depth * 14 + 4 + 'px' }"
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
      <span class="min-w-0 flex-1 truncate text-[13px]" :class="isActive ? 'font-medium' : ''">
        {{ label }}
      </span>

      <span v-if="!selectMode" class="row-actions flex items-center opacity-0">
        <button v-if="isDir" class="btn-icon !h-6 !w-6" :title="$t('tree.importToFolder')" tabindex="-1" @click.stop="emit('importTo', node.path)">
          <AppIcon name="download" :size="13" />
        </button>
        <button v-if="isDir" class="btn-icon !h-6 !w-6" :title="$t('tree.newDoc')" tabindex="-1" @click.stop="emit('newDocIn', node.path)">
          <AppIcon name="filePlus" :size="13" />
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
.row-actions {
  transition: opacity var(--duration-base) var(--ease-plain);
}
.tree-row:hover .row-actions {
  opacity: 1;
}
</style>
