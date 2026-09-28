import { defineStore } from "pinia";
import { ipc } from "@/ipc/ipc";
import type { TreeNode } from "@/ipc/types";
import { extractHeadings, type Heading } from "@/lib/markdown";
import { parseFrontMatter } from "@/lib/frontmatter";
import { stripExt } from "@/lib/paths";
import { useAppStore } from "./app";
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
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
/** 在飞保存的 Promise:保存期间到达的新请求等它结束后重试 */
let savingPromise: Promise<void> = Promise.resolve();
/** openDoc 请求序号:快速连续打开文档时只让最后一次请求生效 */
let openSeq = 0;

export const useEditorStore = defineStore("editor", {
  state: (): State => ({
    activePath: null,
    activeImage: null,
    externalReplace: false,
    content: "",
    savedContent: "",
    saving: false,
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
  },

  actions: {
    reset() {
      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = null;
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
      if (!useAppStore().settings.autosave) return;
      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => {
        void this.save();
      }, 900);
    },

    async save(): Promise<void> {
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
