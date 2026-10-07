<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useUiStore } from "@/stores/ui";
import Modal from "./Modal.vue";
import AppIcon from "./AppIcon.vue";

const { t } = useI18n();
const ui = useUiStore();
</script>

<template>
  <Modal
    v-if="ui.confirm"
    :title="ui.confirm.title"
    :width="380"
    :backdrop-close="false"
    @cancel="ui.resolveConfirm(false)"
  >
    <p class="text-[calc(13.5px*var(--ui-font-scale))] leading-relaxed text-ink-2">{{ ui.confirm.body }}</p>
    <template #footer>
      <button class="btn btn-secondary" @click="ui.resolveConfirm(false)">
        {{ ui.confirm.cancelText ?? t("common.cancel") }}
      </button>
      <!-- 第三个中性动作(如「不保存」):仅在传入文案时出现 -->
      <button v-if="ui.confirm.neutralText" class="btn btn-secondary" @click="ui.resolveConfirm('neutral')">
        {{ ui.confirm.neutralText }}
      </button>
      <button
        class="btn"
        :class="ui.confirm.danger ? 'btn-danger' : 'btn-primary'"
        @click="ui.resolveConfirm(true)"
      >
        {{ ui.confirm.confirmText ?? t("common.confirm") }}
      </button>
    </template>
  </Modal>

  <!-- 通知 -->
  <Teleport to="body">
    <div class="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      <TransitionGroup name="toast">
        <div
          v-for="toast in ui.toasts"
          :key="toast.id"
          class="flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-[calc(13px*var(--ui-font-scale))] shadow-popover"
        >
          <AppIcon
            :name="toast.kind === 'success' ? 'check' : toast.kind === 'error' ? 'alert' : 'doc'"
            :size="15"
            :class="toast.kind === 'error' ? 'text-danger' : 'text-ink-2'"
          />
          <span class="text-ink">{{ toast.text }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
