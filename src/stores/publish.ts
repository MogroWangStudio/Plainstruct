import { defineStore } from "pinia";
import { ipc } from "@/ipc/ipc";
import type { GithubConfig, SyncProgress, SyncResult, VerifyResult } from "@/ipc/types";
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
  }),

  actions: {
    reset() {
      this.$reset();
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
      if (!builder.report) {
        ui.toast(t("publish.needBuild"), "error");
        return;
      }
      // 分支名不能为空:发布分支是站点内容在仓库中的落点
      if (!this.config.branch.trim()) {
        ui.toast(t("publish.branchEmpty"), "error");
        return;
      }
      // 预检提醒(网络异常时忽略,不阻断发布):
      // 本地构建过期 → 建议重新构建;云端被其他设备更新 → 提示将覆盖
      try {
        const pre = await ipc.githubPreflight(this.config);
        if (pre.buildStale) {
          const go = await ui.confirmDialog({
            title: t("publish.staleTitle"),
            body: t("publish.staleBody"),
            confirmText: t("publish.staleConfirm"),
          });
          if (!go) return;
        }
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
      } finally {
        this.syncing = false;
      }
    },

    /** 打开站点:先检测 Pages 是否已部署本次提交,未完成则轮询等待后自动打开 */
    async openSite() {
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
