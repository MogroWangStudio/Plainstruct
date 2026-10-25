import { defineStore } from "pinia";
import type { SyncLogEntry, SyncProgress, SyncResult } from "@/ipc/types";

/**
 * 后台发布任务(全局,不随站点切换重置):
 * 发布发起后切到其他项目,发布流程继续在后台运行 —— 进度、日志与结果
 * 镜像在此,发布页(回到发起站点)与全局药丸栏都从这里读取。
 * 同时只允许一个发布任务;站点根、仓库名与用户可见文案均来自发起时刻。
 */
export type PublishTaskPhase = "building" | "uploading" | "done" | "failed" | "cancelled";

/** Pages 构建监听状态(与发布页的 deployState 同义) */
export type TaskDeployState = "idle" | "building" | "ready" | "errored" | "timeout";

interface State {
  active: boolean;
  /** 发起站点的名称与根目录(回到该站点的发布页即视为接回任务) */
  siteName: string;
  siteRoot: string;
  phase: PublishTaskPhase;
  progress: SyncProgress | null;
  logs: SyncLogEntry[];
  result: SyncResult | null;
  error: string | null;
  /** Pages 构建监听状态(发布成功后轮询,终态供接回时恢复) */
  deployState: TaskDeployState;
  /** 用户请求取消:构建阶段据此跳过上传;上传阶段由后端标志生效 */
  cancelRequested: boolean;
  /** 药丸栏是否已被用户处理(主动关闭或回到发布页),此后不再显示 */
  pillDismissed: boolean;
}

export const usePublishTaskStore = defineStore("publishTask", {
  state: (): State => ({
    active: false,
    siteName: "",
    siteRoot: "",
    phase: "building",
    progress: null,
    logs: [],
    result: null,
    error: null,
    deployState: "idle",
    cancelRequested: false,
    pillDismissed: false,
  }),

  getters: {
    /** 任务是否仍在进行(构建或上传中) */
    running(state): boolean {
      return state.active && (state.phase === "building" || state.phase === "uploading");
    },
  },

  actions: {
    /** 发布发起:记录发起站点并重置任务状态(同一时间仅一个任务,重发即覆盖) */
    begin(siteName: string, siteRoot: string) {
      this.active = true;
      this.siteName = siteName;
      this.siteRoot = siteRoot;
      this.phase = "building";
      this.progress = null;
      this.logs = [];
      this.result = null;
      this.error = null;
      this.deployState = "idle";
      this.cancelRequested = false;
      this.pillDismissed = false;
    },

    /** 任务终态:done/failed/cancelled;药丸转为终态样式,由用户关闭或接回 */
    finish(phase: Exclude<PublishTaskPhase, "building" | "uploading">) {
      this.phase = phase;
      this.progress = null;
    },

    updateProgress(p: SyncProgress | null) {
      this.progress = p;
    },

    /** 进入上传阶段(构建完成,开始同步到 GitHub) */
    startUploading() {
      this.phase = "uploading";
      this.progress = null;
    },

    /** 用户请求取消发布 */
    requestCancel() {
      this.cancelRequested = true;
    },

    setDeployState(s: TaskDeployState) {
      this.deployState = s;
    },

    appendLog(level: SyncLogEntry["level"], message: string, time?: number) {
      this.logs.push({ level, message, time: time ?? Date.now() });
      // 与发布页日志相同的保留上限,避免长任务无限增长
      if (this.logs.length > 300) this.logs.splice(0, this.logs.length - 300);
    },

    /** 用户处理了药丸(主动关闭或回到发布页):本次任务不再显示 */
    dismissPill() {
      this.pillDismissed = true;
    },
  },
});
