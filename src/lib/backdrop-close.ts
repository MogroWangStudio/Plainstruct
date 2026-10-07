/** 弹窗空白区域(模糊遮罩)点击关窗 —— Modal.vue 与各处自绘弹窗共用的同一套行为:
 *  跟随「空白区域点击关窗」设置(默认两次点击,首次轻提示;点进窗口内重新计数) */
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAppStore } from "@/stores/app";
import { useUiStore } from "@/stores/ui";

export function useBackdropClose() {
  const { t } = useI18n();
  const app = useAppStore();
  const ui = useUiStore();

  /** 遮罩已点击次数:两次点击模式下累计 */
  const backdropClicks = ref(0);

  /** 遮罩点击:返回 true 表示应当关窗(由调用方执行各自的关闭动作) */
  function onBackdropClick(): boolean {
    const mode = app.settings.modalBackdropClose ?? "double";
    if (mode === "never") return false;
    if (mode === "single") return true;
    backdropClicks.value++;
    if (backdropClicks.value >= 2) {
      backdropClicks.value = 0;
      return true;
    }
    // 首次点击轻提示后续动作,避免「点了没反应」的困惑
    ui.toast(t("modal.backdropOnceHint"), "info");
    return false;
  }

  /** 点进窗口内即重新计数 */
  function resetBackdropClicks() {
    backdropClicks.value = 0;
  }

  return { onBackdropClick, resetBackdropClicks };
}
