<script setup lang="ts">
/** 通用模态外壳 -- 父级用 v-if 控制出现,Transition 在此组件内;
 *  空白区域(模糊遮罩)点击按设置关窗(默认两次),表单有改动时先询问保存。
 *  移动端(安卓/iOS)以底部 sheet 呈现:贴底全宽,自下而上进出。 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore } from "@/stores/app";
import { useUiStore } from "@/stores/ui";
import { useBackdropClose } from "@/lib/backdrop-close";

const props = defineProps<{
  title: string;
  width?: number;
  /** 强制不响应空白区域点击(需明确作答的弹窗用);缺省跟随设置。
   *  注意勿用可选 Boolean 表达「缺省启用」——Vue 运行时未传的 Boolean prop 是 false 而非 undefined */
  backdropDisabled?: boolean;
  /** 窗口内表单是否有未保存改动:传入后空白关窗前先询问保存 */
  hasChanges?: () => boolean;
  /** 用户选择「保存」时执行;返回 false 视为保存未完成(如必填项缺失),窗口保持打开 */
  saveChanges?: () => boolean | void | Promise<boolean | void>;
  /** 保存询问中确认按钮的文案,缺省「保存并关闭」 */
  saveText?: string;
}>();

const emit = defineEmits<{ cancel: [] }>();

const { t } = useI18n();
const ui = useUiStore();
const { onBackdropClick: backdropClickDecision, resetBackdropClicks } = useBackdropClose();

/** 移动平台:卡片变为底部 sheet(模板与过渡分支) */
const sheet = computed(() => {
  const platform = useAppStore().platform;
  return platform === "android" || platform === "ios";
});

async function onBackdropClick() {
  if (props.backdropDisabled) return;
  if (!backdropClickDecision()) return;
  await requestClose();
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
  resetBackdropClicks();
  emit("cancel");
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex p-6" :class="sheet ? 'items-end p-0' : 'items-center justify-center'">
      <Transition name="scrim" appear>
        <div class="modal-scrim absolute inset-0" @click="onBackdropClick" />
      </Transition>
      <Transition :name="sheet ? 'sheet' : 'modal'" appear>
        <div
          class="modal-card panel relative flex w-full flex-col shadow-window"
          :class="sheet ? 'max-h-[88vh] rounded-b-none pb-[env(safe-area-inset-bottom)]' : 'max-h-[80vh]'"
          :style="sheet ? undefined : { maxWidth: (width ?? 400) + 'px' }"
          @click="resetBackdropClicks"
        >
          <div v-if="sheet" class="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-line-strong" aria-hidden="true" />
          <header class="flex items-center justify-between px-5 pb-3 pt-4" :class="sheet && 'pt-3'">
            <h2 class="text-[calc(15px*var(--ui-font-scale))] font-semibold">{{ title }}</h2>
            <button class="btn-icon" @click="$emit('cancel')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="flex justify-end gap-2 border-t border-line px-5 py-3" :class="sheet && 'pb-[max(12px,env(safe-area-inset-bottom))]'">
            <slot name="footer" />
          </footer>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
/* 底部 sheet:自下而上进出,与遮罩同步;reduced-motion 降级为淡入淡出 */
.sheet-enter-active,
.sheet-leave-active {
  transition: transform 240ms var(--ease-plain);
}
.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(100%);
}
@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active,
  .sheet-leave-active {
    transition: opacity 160ms ease;
  }
  .sheet-enter-from,
  .sheet-leave-to {
    transform: none;
    opacity: 0;
  }
}
</style>
