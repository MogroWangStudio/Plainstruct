import { defineStore } from "pinia";
import { ipc } from "@/ipc/ipc";
import { Events, listen } from "@/ipc/events";
import type { GithubConfig, PublishNotifyMode, SyncLogEntry, SyncProgress, SyncResult, VerifyResult } from "@/ipc/types";
import { i18n } from "@/i18n";
import { useAppStore } from "./app";
import { useBuilderStore } from "./builder";
import { useUiStore } from "./ui";

/** 发送系统通知:官方通知插件 —— 首次发送前先请求系统通知权限
 *  (macOS 的 UNUserNotificationCenter 未授权时直接 show 会静默失败);
 *  权限拒绝或插件不可用时静默跳过,不影响发布流程 */
async function sendSystemNotification(title: string, body: string): Promise<void> {
  try {
    const plugin = await import("@tauri-apps/plugin-notification");
    let granted = await plugin.isPermissionGranted();
    if (!granted) granted = (await plugin.requestPermission()) === "granted";
    if (granted) plugin.sendNotification({ title, body });
  } catch {
    /* 通知不可用(权限拒绝/环境不支持):静默跳过 */
  }
}

/** Pages 构建监听状态:building = 自动轮询中,ready = 本次提交已构建完成 */
export type DeployState = "idle" | "building" | "ready" | "errored" | "timeout";

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
  /** Pages 构建监听:发布成功后自动开始,完成后亮起「查看站点」 */
  deployState: DeployState;
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
    config: { owner: "", repo: "", branch: "gh-pages", token: "", autoCreate: true, accountType: "user", customDomain: "", proxyMode: "system", proxyUrl: "" },
    loaded: false,
    verifying: false,
    verifyResult: null,
    syncing: false,
    progress: null,
    result: null,
    error: null,
    checkingDeploy: false,
    deployState: "idle",
    logs: [],
  }),

  getters: {
    /** 有自定义域名时打开域名地址(DNS 已生效的前提下),否则打开 pages 地址 */
    siteUrl(): string {
      const r = this.result;
      if (!r) return "";
      return r.customDomain ? `https://${r.customDomain}` : r.pagesUrl;
    },
  },

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

    /** 发布系统通知:档位由设置决定(两次/合并一次/关闭)。权限未授予时先请求;
     *  浏览器 mock 为空操作 */
    notifyOf(kind: "published" | "deployed") {
      const app = useAppStore();
      if (app.platform === "browser") return;
      const mode: PublishNotifyMode = app.settings.publishNotify ?? "twice";
      if (mode === "off") return;
      const t = i18n.global.t;
      if (kind === "published") {
        // 合并档位:发布成功不弹,等 Pages 构建完成后发一条合并通知
        if (mode === "twice") {
          void sendSystemNotification(t("publish.notifyPublishedTitle"), t("publish.notifyPublishedBody"));
        }
        return;
      }
      if (mode === "twice") {
        void sendSystemNotification(t("publish.notifyDeployedTitle"), t("publish.notifyDeployedBody"));
      } else {
        void sendSystemNotification(t("publish.notifyMergedTitle"), t("publish.notifyMergedBody"));
      }
    },

    async load() {
      const cfg = await ipc.githubReadConfig();
      // 旧配置没有账户类型字段时按个人账号处理(与后端反序列化默认值一致);
      // 代理字段同理:缺省跟随系统,地址为空
      this.config = {
        ...cfg,
        accountType: cfg.accountType === "org" ? "org" : "user",
        proxyMode: cfg.proxyMode === "none" || cfg.proxyMode === "custom" ? cfg.proxyMode : "system",
        proxyUrl: cfg.proxyUrl ?? "",
      };
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
      this.deployState = "idle";
      try {
        await this.save();
        this.result = await ipc.githubSync(this.config, (p) => {
          this.progress = p;
        });
        // 发布成功:系统通知(按设置档位),并自动监听 Pages 构建
        this.notifyOf("published");
        void this.watchDeploy();
      } catch (e) {
        this.error = ipc.errText(e);
        // 错误同步落入运行日志,便于用户定位失败环节
        this.appendLog("error", this.error);
      } finally {
        this.syncing = false;
      }
    },

    /**
     * 自动监听 Pages 构建(轮询 pages/builds/latest,上限 3 分钟):
     * 完成 → 亮起「查看站点」并弹出提示;失败/超时 → 相应提示;
     * 查询异常(网络等)→ 回到待检测,点击按钮时仍会检测。
     */
    async watchDeploy() {
      const ui = useUiStore();
      const t = i18n.global.t;
      if (!this.result || this.deployState === "building") return;
      this.deployState = "building";
      this.appendLog("info", t("publish.logWatchDeploy"));
      const deadline = Date.now() + 180_000;
      try {
        while (Date.now() < deadline) {
          const st = await ipc.githubPagesStatus(this.config, this.result.commitSha);
          if (st.ready) {
            this.deployState = "ready";
            this.appendLog("success", t("publish.deployReadyToast"));
            ui.toast(t("publish.deployReadyToast"), "success");
            this.notifyOf("deployed");
            return;
          }
          if (st.errored) {
            this.deployState = "errored";
            this.appendLog("error", t("publish.deployErrored"));
            ui.toast(t("publish.deployErrored"), "error");
            return;
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
        this.deployState = "timeout";
        this.appendLog("info", t("publish.deployTimeout"));
        ui.toast(t("publish.deployTimeout"), "info");
      } catch {
        this.deployState = "idle";
        this.appendLog("info", t("publish.deployWatchFailed"));
      }
    },

    /**
     * 点击绿色发布球(PublishView):先看 Pages 是否构建完成 ——
     * 完成 → 弹窗询问是否前往查看;未完成 → 提示稍候,不再误触重新发布。
     */
    async viewPublishedSite() {
      const ui = useUiStore();
      const t = i18n.global.t;
      if (!this.result || this.checkingDeploy) return;
      if (this.deployState === "building") {
        ui.toast(t("publish.deployWaitHint"), "info");
        return;
      }
      if (this.deployState === "errored") {
        ui.toast(t("publish.deployErrored"), "error");
        return;
      }
      if (this.deployState !== "ready") {
        // 状态未知(监听失败/超时):单击检测一次再分流
        this.checkingDeploy = true;
        try {
          const st = await ipc.githubPagesStatus(this.config, this.result.commitSha);
          if (st.ready) this.deployState = "ready";
          else if (st.errored) {
            this.deployState = "errored";
            ui.toast(t("publish.deployErrored"), "error");
            return;
          } else {
            ui.toast(t("publish.deployWaitHint"), "info");
            return;
          }
        } catch {
          // 状态查询失败(网络等):与 openSite 的降级一致,交给弹窗由用户决定
          this.deployState = "ready";
        } finally {
          this.checkingDeploy = false;
        }
      }
      const go = await ui.confirmDialog({
        title: t("publish.viewAskTitle"),
        body: t("publish.viewAskBody"),
        confirmText: t("publish.viewGo"),
        cancelText: t("publish.viewLater"),
      });
      if (go === true) await this.openSite();
    },

    /** 前往目标仓库页面 */
    openRepo() {
      if (!this.config.owner || !this.config.repo) return;
      void ipc.openExternal(`https://github.com/${this.config.owner}/${this.config.repo}`);
    },

    /** 打开站点:构建已确认完成时直接打开;否则先检测 Pages 部署,未完成则轮询等待后自动打开 */
    async openSite() {
      const ui = useUiStore();
      const t = i18n.global.t;
      if (!this.result || this.checkingDeploy) return;
      if (this.deployState === "ready") {
        await ipc.openExternal(this.siteUrl);
        return;
      }
      if (this.deployState === "building") return;
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
          this.deployState = "ready";
          await ipc.openExternal(this.siteUrl);
          ui.toast(t("publish.deployReady"), "success");
        } else if (errored) {
          ui.toast(t("publish.deployErrored"), "error");
        } else {
          ui.toast(t("publish.deployTimeout"), "info");
        }
      } catch {
        // 部署状态查询失败(网络等):降级为直接打开,行为与不检测时一致
        await ipc.openExternal(this.siteUrl);
      } finally {
        this.checkingDeploy = false;
      }
    },
  },
});
