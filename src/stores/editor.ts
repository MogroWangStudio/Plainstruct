import { defineStore } from "pinia";
import { shallowRef } from "vue";
import type { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { ipc } from "@/ipc/ipc";
import type { TreeNode } from "@/ipc/types";
import { extractHeadings, type Heading } from "@/lib/markdown";
import { parseFrontMatter } from "@/lib/frontmatter";
import { stripExt } from "@/lib/paths";
import { normalizeAutosaveDelay, useAppStore } from "./app";
import { useBuilderStore } from "./builder";
import { useSiteStore } from "./site";

export type EditorMode = "edit" | "split" | "preview";

interface State {
  activePath: string | null;
  /** 内容树中选中的图片文件(显示预览而非编辑器),与 activePath 互斥展示 */
  activeImage: string | null;
  /** 外部(非编辑器)写回内容时置位:MarkdownEditor 据此把新内容同步进 CodeMirror */
  externalReplace: boolean;
  content: string;
  savedContent: string;
  saving: boolean;
  mode: EditorMode;
  headings: Heading[];
  /** 自动保存倒计时:距落盘的剩余毫秒(null = 无倒计时,自动保存关闭或已就绪) */
  autosaveCountdown: number | null;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
/** 自动保存倒计时的目标时刻与显示节拍(100ms 粒度,仅倒计时期间运行) */
let autosaveDeadline = 0;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
/** 在飞保存的 Promise:保存期间到达的新请求等它结束后重试 */
let savingPromise: Promise<void> = Promise.resolve();
/** openDoc 请求序号:快速连续打开文档时只让最后一次请求生效 */
let openSeq = 0;
/** 当前文档的 CodeMirror 实例:全局撤销/重做按钮经此驱动编辑器历史。
 *  用模块级 shallowRef 而非 store state:避免 Pinia 深层响应式代理 CodeMirror 实例 */
const cmViewRef = shallowRef<EditorView | null>(null);

/** 停止倒计时显示(保存/重开文档/关闭自动保存时);store 由调用方传入 */
function stopCountdown(store: { autosaveCountdown: number | null }) {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  autosaveDeadline = 0;
  store.autosaveCountdown = null;
}

export const useEditorStore = defineStore("editor", {
  state: (): State => ({
    activePath: null,
    activeImage: null,
    externalReplace: false,
    content: "",
    savedContent: "",
    saving: false,
    autosaveCountdown: null,
    mode: "split",
    headings: [],
  }),

  getters: {
    dirty(state): boolean {
      return state.activePath !== null && state.content !== state.savedContent;
    },
    docTitle(state): string {
      if (!state.activePath) return "";
      const { data } = parseFrontMatter(state.content);
      return data.title ?? stripExt(state.activePath.split("/").pop() ?? "");
    },
    /** 全局撤销/重做可用性:有活动的编辑器实例且文档已打开 */
    canUndo(): boolean {
      return cmViewRef.value !== null && this.activePath !== null;
    },
    canRedo(): boolean {
      return cmViewRef.value !== null && this.activePath !== null;
    },
  },

  actions: {
    /** MarkdownEditor 挂载/卸载时登记编辑器实例(全局撤销/重做与文档生命周期同步) */
    registerView(view: EditorView) {
      cmViewRef.value = view;
    },
    unregisterView(view: EditorView) {
      if (cmViewRef.value === view) cmViewRef.value = null;
    },

    /** 全局撤销/重做:作用于当前文档的 CodeMirror 历史;无实例时为空操作 */
    doUndo() {
      const view = cmViewRef.value;
      if (!view) return;
      if (undo(view)) view.focus();
    },
    doRedo() {
      const view = cmViewRef.value;
      if (!view) return;
      if (redo(view)) view.focus();
    },

    reset() {
      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = null;
      stopCountdown(this);
      openSeq++; // 使在飞的 openDoc 结果过期
      this.$reset();
    },

    async openDoc(node: TreeNode) {
      const app = useAppStore();
      if (app.view !== "editor") app.setView("editor");
      const seq = ++openSeq;
      if (this.dirty) await this.save();
      const [text] = await ipc.readDocs([node.path]);
      // 等待期间用户已打开其他文档或重置:丢弃过期结果,避免内容错乱
      if (seq !== openSeq) return;
      // 等待期间用户又输入过:先把当前内容补存回旧文档再切换,否则这些输入
      // 会随 content 被整块覆盖且从未落盘
      if (this.activePath && this.dirty) await this.save();
      this.activeImage = null;
      this.activePath = node.path;
      this.content = text ?? "";
      this.savedContent = text ?? "";
      this.headings = extractHeadings(this.content);
    },

    /** 选中内容树中的图片文件:显示图片预览(编辑中的文档保持原状,不打断保存) */
    openImage(path: string) {
      const app = useAppStore();
      if (app.view !== "editor") app.setView("editor");
      this.activeImage = path;
    },

    /** 编辑器内容变更(来自 CodeMirror) */
    onInput(text: string) {
      this.content = text;
      this.headings = extractHeadings(text);
      if (!useAppStore().settings.autosave) {
        stopCountdown(this);
        return;
      }
      if (autosaveTimer) clearTimeout(autosaveTimer);
      // 停止输入后延迟落盘:延迟可在设置中调整(历史数据缺省 900ms);
      // 保存状态区同步显示剩余时间的倒计时
      const delay = normalizeAutosaveDelay(useAppStore().settings.autosaveDelay);
      autosaveTimer = setTimeout(() => {
        stopCountdown(this);
        void this.save();
      }, delay);
      autosaveDeadline = Date.now() + delay;
      this.autosaveCountdown = delay;
      if (!countdownTimer) {
        countdownTimer = setInterval(() => {
          const left = autosaveDeadline - Date.now();
          if (left <= 0) {
            // 到点:显示清零,落盘由挂起的 setTimeout 负责
            stopCountdown(this);
            return;
          }
          if (!useAppStore().settings.autosave) {
            // 保存期间关闭了自动保存:连挂起的定时保存一并取消
            if (autosaveTimer) {
              clearTimeout(autosaveTimer);
              autosaveTimer = null;
            }
            stopCountdown(this);
            return;
          }
          this.autosaveCountdown = left;
        }, 100);
      }
    },

    async save(): Promise<void> {
      // 手动保存即清掉倒计时(内容落盘后状态区回到「已保存」)
      stopCountdown(this);
      if (!this.activePath || this.content === this.savedContent) return;
      // 已有保存在飞:等它结束后再存一次,保证飞行期间的输入也被落盘
      if (this.saving) {
        await savingPromise;
        return this.save();
      }
      const path = this.activePath;
      const text = this.content;
      let resolveSaving!: () => void;
      savingPromise = new Promise<void>((r) => (resolveSaving = r));
      this.saving = true;
      try {
        await ipc.saveDoc(path, text);
        // 写入快照而非当前 content:保存期间继续输入的内容保持 dirty,由重试落盘
        if (this.activePath === path) this.savedContent = text;
        useSiteStore().updateDocCache(path, text);
        useBuilderStore().onSiteChanged();
      } finally {
        this.saving = false;
        resolveSaving();
      }
    },

    setMode(mode: EditorMode) {
      this.mode = mode;
    },
  },
});
