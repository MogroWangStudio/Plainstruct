<script setup lang="ts">
/** 通用模态外壳 -- 父级用 v-if 控制出现,Transition 在此组件内 */
defineProps<{ title: string; width?: number }>();
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-6">
      <Transition name="scrim" appear>
        <div class="absolute inset-0 bg-[var(--color-scrim)]" @click="$emit('cancel')" />
      </Transition>
      <Transition name="modal" appear>
        <div
          class="modal-card panel relative flex max-h-[80vh] w-full flex-col shadow-window"
          :style="{ maxWidth: (width ?? 400) + 'px' }"
        >
          <header class="flex items-center justify-between px-5 pb-3 pt-4">
            <h2 class="text-[calc(15px*var(--ui-font-scale))] font-semibold">{{ title }}</h2>
            <button class="btn-icon" @click="$emit('cancel')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="flex justify-end gap-2 border-t border-line px-5 py-3">
            <slot name="footer" />
          </footer>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>
