<script setup lang="ts">
/** 软件专属右键菜单渲染器:视口内自动收位,Esc/点击空白/滚轮关闭 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useContextMenuStore } from "@/stores/contextMenu";
import { toCssPx } from "@/lib/scale";
import AppIcon from "./AppIcon.vue";

const ui = useContextMenuStore();
const panel = ref<HTMLElement | null>(null);
const pos = ref({ x: 0, y: 0 });

watch(
  () => ui.open,
  async (open) => {
    if (!open) return;
    pos.value = { x: ui.x, y: ui.y };
    await nextTick();
    const el = panel.value;
    if (!el) return;
    // 收位比较在视觉像素中进行(ui.x/rect/视口同系);赋值经 toCssPx 还原为
    // 面板 CSS 坐标,界面缩放(zoom)档位下位置不漂移
    const rect = el.getBoundingClientRect();
    pos.value = {
      x: toCssPx(Math.max(4, Math.min(ui.x, window.innerWidth - rect.width - 4))),
      y: toCssPx(Math.max(4, Math.min(ui.y, window.innerHeight - rect.height - 4))),
    };
  },
);

function onOverlayDown(e: MouseEvent) {
  if (panel.value && e.target instanceof Node && panel.value.contains(e.target)) return;
  ui.close();
}

function onItem(item: (typeof ui.items)[number]) {
  if (item.disabled) return;
  ui.close();
  item.run?.();
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && ui.open) ui.close();
}

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <Transition name="ctx">
      <div
        v-if="ui.open"
        class="fixed inset-0 z-[80]"
        @mousedown="onOverlayDown"
        @wheel="ui.close()"
      >
        <div ref="panel" class="ctx-panel" :style="{ left: pos.x + 'px', top: pos.y + 'px' }" role="menu">
          <template v-for="item in ui.items" :key="item.id">
            <div v-if="item.separator" class="ctx-sep" role="separator" />
            <button
              v-else
              type="button"
              class="ctx-item"
              :class="{ 'ctx-item-danger': item.danger, 'ctx-item-disabled': item.disabled }"
              role="menuitem"
              :disabled="item.disabled"
              @mousedown.prevent
              @click="onItem(item)"
            >
              <AppIcon v-if="item.icon" :name="item.icon" :size="15" class="shrink-0 opacity-80" />
              <span class="min-w-0 flex-1 truncate text-left">{{ item.label }}</span>
              <span v-if="item.shortcut" class="ctx-kbd">{{ item.shortcut }}</span>
            </button>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ctx-panel {
  position: absolute;
  min-width: 176px;
  max-width: 280px;
  padding: 5px;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: var(--shadow-popover);
  transform-origin: top left;
}

.ctx-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--color-ink);
  font-size: calc(13px * var(--ui-font-scale));
  text-align: left;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-plain);
}

.ctx-item:hover {
  background: var(--color-surface-2);
}

.ctx-item-danger {
  color: var(--color-danger);
}

.ctx-item-danger:hover {
  background: var(--color-danger-soft);
}

.ctx-item-disabled {
  color: var(--color-ink-3);
  cursor: default;
  opacity: 0.7;
}

.ctx-item-disabled:hover {
  background: transparent;
}

.ctx-kbd {
  flex-shrink: 0;
  font-size: calc(11px * var(--ui-font-scale));
  color: var(--color-ink-3);
}

.ctx-sep {
  height: 1px;
  margin: 5px 8px;
  background: var(--color-line);
}

/* 浮现:轻微缩放 + 上移,非线性缓动(无过冲) */
.ctx-enter-active .ctx-panel {
  transition:
    opacity 140ms var(--ease-plain),
    transform 180ms var(--ease-plain);
}
.ctx-leave-active {
  transition: opacity 100ms var(--ease-plain-inverse);
}
.ctx-enter-from .ctx-panel {
  opacity: 0;
  transform: scale(0.96);
}
.ctx-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .ctx-enter-active .ctx-panel,
  .ctx-leave-active {
    transition: none;
  }
}
</style>
