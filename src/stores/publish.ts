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
  },
});
