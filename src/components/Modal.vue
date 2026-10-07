<script setup lang="ts">
/** 通用模态外壳 -- 父级用 v-if 控制出现,Transition 在此组件内;
 *  空白区域(模糊遮罩)点击按设置关窗(默认两次),表单有改动时先询问保存 */
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore } from "@/stores/app";
import { useUiStore } from "@/stores/ui";

const props = defineProps<{
  title: string;
  width?: number;
  /** 是否响应空白区域点击:缺省跟随设置;false = 强制不响应(如确认框) */
  backdropClose?: boolean;
  /** 窗口内表单是否有未保存改动:传入后空白关窗前先询问保存 */
  hasChanges?: () => boolean;
  /** 用户选择「保存」时执行;返回 false 视为保存未完成(如必填项缺失),窗口保持打开 */
  saveChanges?: () => boolean | void | Promise<boolean | void>;
  /** 保存询问中确认按钮的文案,缺省「保存并关闭」 */
  saveText?: string;
}>();

const emit = defineEmits<{ cancel: [] }>();

const { t } = useI18n();
const app = useAppStore();
const ui = useUiStore();

/** 空白区域已点击次数:两次点击模式下累计,点进窗口内即清零 */
const backdropClicks = ref(0);

async function onBackdropClick() {
  if (props.backdropClose === false) return;
  const mode = app.settings.modalBackdropClose ?? "double";
  if (mode === "never") return;
  if (mode === "single") {
    await requestClose();
    return;
  }
  // 两次点击:首次轻提示后续动作,避免「点了没反应」的困惑
  backdropClicks.value++;
  if (backdropClicks.value >= 2) {
    backdropClicks.value = 0;
    await requestClose();
    return;
  }
  ui.toast(t("modal.backdropOnceHint"), "info");
}

/** 空白触发的关窗:表单有改动时先弹出保存询问(保存 / 不保存 / 取消) */
async function requestClose() {
  if (props.hasChanges?.()) {
    const r = await ui.confirmDialog({
      title: t("modal.changesTitle"),
      body: t("modal.changesBody"),
      confirmText: props.saveText ?? t("modal.saveAndClose"),
      neutralText: t("modal.discardAndClose"),
    });
    if (r === false) return; // 取消:留在窗口继续编辑
    if (r !== true) {
      emit("cancel"); // 不保存:放弃改动直接关窗
      return;
    }
    const ok = await props.saveChanges?.();
    if (ok === false) return; // 保存未完成,窗口保持打开
  }
  backdropClicks.value = 0;
  emit("cancel");
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-6">
      <Transition name="scrim" appear>
        <div class="modal-scrim absolute inset-0" @click="onBackdropClick" />
      </Transition>
      <Transition name="modal" appear>
        <div
          class="modal-card panel relative flex max-h-[80vh] w-full flex-col shadow-window"
          :style="{ maxWidth: (width ?? 400) + 'px' }"
          @click="backdropClicks = 0"
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
