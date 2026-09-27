import { defineStore } from "pinia";
import { ipc } from "@/ipc/ipc";
import { Events, listen } from "@/ipc/events";
import type { GithubConfig, SyncLogEntry, SyncProgress, SyncResult, VerifyResult } from "@/ipc/types";
import { i18n } from "@/i18n";
import { useBuilderStore } from "./builder";
import { useUiStore } from "./ui";

interface State {
  config: GithubConfig;
  loaded: boolean;
  verifying: boolean;
  verifyResult: VerifyResult | null;
  syncing: boolean;
  progress: SyncProgress | null;
  result: SyncResult | null;
  error: string | null;
  /** 正在等待 GitHub Pages 部署本次发布 */
  checkingDeploy: boolean;
  /** 发布运行日志(实时) */
  logs: SyncLogEntry[];
}

/** 发布日志事件监听:模块级仅注册一次,浏览器环境为空操作 */
let logListening = false;
function ensureLogListener() {
  if (logListening) return;
  logListening = true;
  void listen<{ level: string; message: string; time: number }>(Events.PublishLog, (p) => {
    const level = p.level === "error" || p.level === "success" ? p.level : "info";
    usePublishStore().appendLog(level, p.message, p.time);
  });
}

export const usePublishStore = defineStore("publish", {
  state: (): State => ({
    config: { owner: "", repo: "", branch: "gh-pages", token: "", autoCreate: true },
    loaded: false,
    verifying: false,
    verifyResult: null,
    syncing: false,
    progress: null,
    result: null,
    error: null,
    checkingDeploy: false,
    logs: [],
  }),

  actions: {
    reset() {
      this.$reset();
    },

    appendLog(level: SyncLogEntry["level"], message: string, time?: number) {
      this.logs.push({ level, message, time: time ?? Date.now() });
      // 日志保留上限,避免长时间使用无限增长
      if (this.logs.length > 300) this.logs.splice(0, this.logs.length - 300);
    },

    clearLogs() {
      this.logs = [];
    },

    async load() {
      this.config = await ipc.githubReadConfig();
      this.loaded = true;
    },

    async save() {
      await ipc.githubSaveConfig(this.config);
    },

    async verify() {
      this.verifying = true;
      this.verifyResult = null;
      try {
        this.verifyResult = await ipc.githubVerify(this.config);
        await this.save();
      } finally {
        this.verifying = false;
      }
    },

    async sync() {
      const builder = useBuilderStore();
      const ui = useUiStore();
      const t = i18n.global.t;
      // 分支名不能为空:发布分支是站点内容在仓库中的落点
      if (!this.config.branch.trim()) {
        ui.toast(t("publish.branchEmpty"), "error");
        return;
      }
      ensureLogListener();
      this.logs = [];
      this.appendLog("info", t("publish.logStart", { repo: `${this.config.owner}/${this.config.repo}` }));

      // 发布前自动构建:产物始终与站点内容一致(修改与删除一并生效)
      this.appendLog("info", t("publish.autoBuild"));
      await builder.build();
      if (builder.error) {
        this.error = builder.error;
        this.appendLog("error", t("publish.autoBuildFailed", { msg: builder.error }));
        ui.toast(t("publish.autoBuildFailed", { msg: builder.error }), "error");
        return;
      }
      this.appendLog("success", t("publish.autoBuildDone"));

      // 预检提醒(网络异常时忽略,不阻断发布):
      // 云端被其他设备更新 → 提示将覆盖
      try {
        const pre = await ipc.githubPreflight(this.config);
        if (pre.remoteDirty) {
          const go = await ui.confirmDialog({
            title: t("publish.remoteTitle"),
            body: t("publish.remoteBody"),
            confirmText: t("publish.remoteConfirm"),
          });
          if (!go) return;
        }
      } catch {
        /* 预检失败不阻断发布 */
      }
      this.syncing = true;
      this.progress = null;
      this.result = null;
      this.error = null;
      try {
        await this.save();
        this.result = await ipc.githubSync(this.config, (p) => {
          this.progress = p;
        });
      } catch (e) {
        this.error = ipc.errText(e);
        // 错误同步落入运行日志,便于用户定位失败环节
        this.appendLog("error", this.error);
      } finally {
        this.syncing = false;
      }
    },

    /** 前往目标仓库页面 */
    openRepo() {
      if (!this.config.owner || !this.config.repo) return;
      void ipc.openExternal(`https://github.com/${this.config.owner}/${this.config.repo}`);
    },

    /** 打开站点:先检测 Pages 是否已部署本次提交,未完成则轮询等待后自动打开 */    async openSite() {
      const ui = useUiStore();
      const t = i18n.global.t;
      if (!this.result || this.checkingDeploy) return;
      this.checkingDeploy = true;
      try {
        // 上限 3 分钟:Pages 部署通常 1-2 分钟内完成
        const deadline = Date.now() + 180_000;
        let ready = false;
        let errored = false;
        while (Date.now() < deadline) {
          const st = await ipc.githubPagesStatus(this.config, this.result.commitSha);
          if (st.ready) {
            ready = true;
            break;
          }
          if (st.errored) {
            errored = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
        if (ready) {
          await ipc.openExternal(this.result.pagesUrl);
          ui.toast(t("publish.deployReady"), "success");
        } else if (errored) {
          ui.toast(t("publish.deployErrored"), "error");
        } else {
          ui.toast(t("publish.deployTimeout"), "info");
        }
      } catch {
        // 部署状态查询失败(网络等):降级为直接打开,行为与不检测时一致
        await ipc.openExternal(this.result.pagesUrl);
      } finally {
        this.checkingDeploy = false;
      }
    },
  },
});
