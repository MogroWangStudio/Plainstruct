import { defineStore } from "pinia";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface ConfirmState {
  title: string;
  body: string;
  danger?: boolean;
  confirmText?: string;
  /** 取消按钮文案,缺省「取消」 */
  cancelText?: string;
  /** 第三个中性动作(如「不保存」):点击时 Promise 以 "neutral" 收尾 */
  neutralText?: string;
}

interface State {
  toasts: Toast[];
  confirm: ConfirmState | null;
}

/** 确认框结算值: true=确认 false=取消 "neutral"=第三个中性动作 */
export type ConfirmResult = boolean | "neutral";

let toastId = 0;
let confirmResolver: ((ok: ConfirmResult) => void) | null = null;

/** 结算当前未决的确认框(有新框覆盖或用户选择时调用) */
function settleConfirm(ok: ConfirmResult) {
  confirmResolver?.(ok);
  confirmResolver = null;
}

export const useUiStore = defineStore("ui", {
  state: (): State => ({
    toasts: [],
    confirm: null,
  }),

  actions: {
    toast(text: string, kind: ToastKind = "info") {
      const id = ++toastId;
      this.toasts.push({ id, kind, text });
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id);
      }, 2600);
    },

    /** 弹出确认框,返回用户选择(true/false/"neutral") */
    confirmDialog(opts: ConfirmState): Promise<ConfirmResult> {
      // 新确认框覆盖旧的:被覆盖的未决调用以「取消」收尾,避免 Promise 永不 resolve
      settleConfirm(false);
      this.confirm = opts;
      return new Promise((resolve) => {
        confirmResolver = resolve;
      });
    },

    resolveConfirm(ok: ConfirmResult) {
      settleConfirm(ok);
      this.confirm = null;
    },
  },
});
