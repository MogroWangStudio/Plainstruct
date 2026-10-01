<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useAppStore, type AppView } from "@/stores/app";
import { useEditorStore } from "@/stores/editor";
import AppIcon from "./AppIcon.vue";

const { t } = useI18n();
const app = useAppStore();
const editor = useEditorStore();

const items: { view: AppView; icon: string; label: string }[] = [
  { view: "editor", icon: "doc", label: "nav.editor" },
  { view: "assets", icon: "assets", label: "nav.assets" },
  { view: "site", icon: "sliders", label: "nav.site" },
  { view: "theme", icon: "palette", label: "nav.theme" },
  { view: "build", icon: "box", label: "nav.build" },
  { view: "publish", icon: "upload", label: "nav.publish" },
];
</script>

<template>
  <nav class="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-2">
    <button
      v-for="item in items"
      :key="item.view"
      class="nav-btn"
      :class="{ active: app.view === item.view }"
      :title="t(item.label)"
      :aria-label="t(item.label)"
      @click="app.setView(item.view)"
    >
      <AppIcon :name="item.icon" :size="19" />
    </button>

    <button
      class="nav-btn mt-auto"
      :disabled="!editor.canUndo"
      :title="t('editor.undo')"
      :aria-label="t('editor.undo')"
      @click="editor.doUndo()"
    >
      <AppIcon name="undo" :size="18" />
    </button>

    <button
      class="nav-btn"
      :disabled="!editor.canRedo"
      :title="t('editor.redo')"
      :aria-label="t('editor.redo')"
      @click="editor.doRedo()"
    >
      <AppIcon name="redo" :size="18" />
    </button>

    <button
      class="nav-btn"
      :class="{ active: app.view === 'settings' }"
      :title="t('nav.settings')"
      :aria-label="t('nav.settings')"
      @click="app.setView('settings')"
    >
      <AppIcon name="settings" :size="18" />
    </button>

    <button
      class="nav-btn"
      :class="{ active: app.view === 'about' }"
      :title="t('nav.about')"
      :aria-label="t('nav.about')"
      @click="app.setView('about')"
    >
      <AppIcon name="info" :size="18" />
    </button>
  </nav>
</template>

<style scoped>
.nav-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--color-ink-3);
  cursor: pointer;
  transition:
    background-color var(--duration-base) var(--ease-plain),
    color var(--duration-base) var(--ease-plain),
    transform var(--duration-fast) ease-out;
}
.nav-btn:hover {
  background: var(--color-surface-2);
  color: var(--color-ink-2);
}
.nav-btn:active {
  transform: scale(0.94);
}
.nav-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.nav-btn:disabled:hover {
  background: transparent;
  color: var(--color-ink-3);
}
.nav-btn.active {
  background: var(--color-surface-2);
  color: var(--color-ink);
}
.nav-btn.active::before {
  content: "";
  position: absolute;
  left: -6px;
  width: 2px;
  height: 16px;
  border-radius: 1px;
  background: var(--color-accent);
}
</style>
