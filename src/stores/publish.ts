import { defineStore } from "pinia";
import { ipc } from "@/ipc/ipc";
import { Events, listen } from "@/ipc/events";
import type { GithubConfig, NotifyAction, PublishNotifyMode, SyncLogEntry, SyncProgress, SyncResult, VerifyResult } from "@/ipc/types";
import { i18n } from "@/i18n";
import { useAppStore } from "./app";
import { useBuilderStore } from "./builder";
import { useSiteStore } from "./site";
import { usePublishTaskStore } from "./publishTask";
import { useUiStore } from "./ui";

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

/** 发布日志事件监听:模块级仅注册一次,浏览器环境为空操作。
 *  后台发布期间(任务站点 ≠ 当前站点)日志只进后台任务,不串入别的站点 */
let logListening = false;
function ensureLogListener() {
  if (logListening) return;
  logListening = true;
  void listen<{ level: string; message: string; time: number }>(Events.PublishLog, (p) => {
    const level = p.level === "error" || p.level === "success" ? p.level : "info";
    const task = usePublishTaskStore();
    const site = useSiteStore();
    if (!task.active || task.siteRoot === site.root) usePublishStore().appendLog(level, p.message, p.time);
    if (task.active) task.appendLog(level, p.message, p.time);
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

    /** 发布系统通知:档位由设置决定(两次/合并一次/关闭)。后端直接投递
     *  (macOS 现代通知中心/Windows AUMID 兕底),失败信息落入发布日志,
     *  浏览器 mock 为空操作;站点地址由调用方传入(后台完成时发布页不在场) */
    notifyOf(kind: "published" | "deployed", siteUrl?: string) {
      const url = siteUrl ?? this.siteUrl;
      const app = useAppStore();
      if (app.platform === "browser") return;
      const mode: PublishNotifyMode = app.settings.publishNotify ?? "twice";
      if (mode === "off") return;
      const t = i18n.global.t;
      const send = async (title: string, body: string, actions: NotifyAction[] = []) => {
        try {
          await ipc.systemNotify(title, body, actions);
        } catch (e) {
          // 通知不可用不阻断发布流程,但让用户知道原因(发布日志可见)
          this.appendLog("info", `[系统通知] ${ipc.errText(e)}`);
        }
      };
      if (kind === "published") {
        // 合并档位:发布成功不弹,等 Pages 构建完成后发一条合并通知
        if (mode === "twice") {
          void send(t("publish.notifyPublishedTitle"), t("publish.notifyPublishedBody"), [
            { label: t("publish.notifyActionOpenApp"), arg: "plainstruct://publish" },
          ]);
        }
        return;
      }
      // Pages 构建完成(或合并通知):按钮直达站点(有自定义域名时为域名)
      const actions: NotifyAction[] = url ? [{ label: t("publish.notifyActionViewSite"), arg: url }] : [];
      if (mode === "twice") {
        void send(t("publish.notifyDeployedTitle"), t("publish.notifyDeployedBody"), actions);
      } else {
        void send(t("publish.notifyMergedTitle"), t("publish.notifyMergedBody"), actions);
      }
    },

    async load() {
      // 回到发起后台发布的站点:接回任务(进行中或已完成的结果都恢复),
      // 药丸栏随之消失 —— 用户已在发布页,状态就地可见
      const task = usePublishTaskStore();
      const site = useSiteStore();
      if (task.active && task.siteRoot === site.root) {
        this.syncing = task.phase === "building" || task.phase === "uploading";
        this.progress = task.progress;
        this.logs = [...task.logs];
        this.result = task.result;
        this.error = task.error;
        this.deployState = task.deployState;
        task.dismissPill();
      }
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

    /** 请求取消发布:构建阶段跳过上传,上传阶段由后端中止并回退站点引用 */
    cancel() {
      const task = usePublishTaskStore();
      const site = useSiteStore();
      if (!task.running || task.cancelRequested) return;
      task.requestCancel();
      void ipc.githubPublishCancel();
      const msg = i18n.global.t("publish.cancelRequestedLog");
      if (!task.active || task.siteRoot === site.root) this.appendLog("info", msg);
      task.appendLog("info", msg);
    },

    async sync() {
      const builder = useBuilderStore();
      const ui = useUiStore();
      const site = useSiteStore();
      const task = usePublishTaskStore();
      const t = i18n.global.t;
      // 同一时间只允许一个发布任务(后台任务运行中时禁止再次发起)
      if (task.running) {
        ui.toast(t("publish.taskBusy", { name: task.siteName }), "error");
        return;
      }
      // 分支名不能为空:发布分支是站点内容在仓库中的落点
      if (!this.config.branch.trim()) {
        ui.toast(t("publish.branchEmpty"), "error");
        return;
      }
      // 配置立即落盘:此后切站会重载本 store,必须先把发起站点的配置写回其目录
      await this.save();
      ensureLogListener();
      this.logs = [];
      // 配置快照:切站会重载 store(配置变成别的站点的),后续一律用快照
      const cfg: GithubConfig = { ...this.config };
      const taskRoot = site.root;

      task.begin(site.config?.name ?? "", taskRoot);
      /** 当前站点是否已不是发起站点(发布已转后台) */
      const detached = () => site.root !== taskRoot;
      /** 任务是否仍属于本次发布(未被新的发布覆盖) */
      const mine = () => task.active && task.siteRoot === taskRoot;
      /** 发布日志:发布页在场时同步进页面日志,始终进后台任务 */
      const log = (level: SyncLogEntry["level"], msg: string) => {
        if (!mine()) return;
        if (detached()) task.appendLog(level, msg);
        else {
          this.appendLog(level, msg);
          task.appendLog(level, msg);
        }
      };
      log("info", t("publish.logStart", { repo: `${cfg.owner}/${cfg.repo}` }));

      // 登记后台任务占用的站点根:期间切站/关站,构建落盘与上传仍指向发起站点
      try {
        await ipc.githubPublishBegin(site.root);
      } catch (e) {
        task.error = ipc.errText(e);
        log("error", task.error);
        task.finish("failed");
        return;
      }

      // 发布前自动构建:产物始终与站点内容一致(修改与删除一并生效)。
      // 构建期间切站时产物照常写入发起站点(后端按登记的根放行),发布继续
      log("info", t("publish.autoBuild"));
      await builder.build();
      if (builder.error) {
        task.error = builder.error;
        log("error", t("publish.autoBuildFailed", { msg: builder.error }));
        task.finish("failed");
        void ipc.githubPublishEnd();
        ui.toast(t("publish.autoBuildFailed", { msg: builder.error }), "error");
        return;
      }
      log("success", t("publish.autoBuildDone"));
      if (task.cancelRequested) {
        // 构建阶段收到取消:不再开始上传,站点无任何变更
        log("info", t("publish.cancelledLog"));
        task.finish("cancelled");
        void ipc.githubPublishEnd();
        return;
      }

      // 预检提醒(网络异常时忽略,不阻断发布):
      // 云端被其他设备更新 → 提示将覆盖(后台接回时不再询问,按当前配置继续)
      try {
        const pre = await ipc.githubPreflight(cfg);
        if (pre.remoteDirty && !detached()) {
          const go = await ui.confirmDialog({
            title: t("publish.remoteTitle"),
            body: t("publish.remoteBody"),
            confirmText: t("publish.remoteConfirm"),
          });
          if (!go) {
            log("info", t("publish.cancelledLog"));
            task.finish("cancelled");
            void ipc.githubPublishEnd();
            return;
          }
        }
      } catch {
        /* 预检失败不阻断发布 */
      }

      this.syncing = true;
      this.progress = null;
      this.result = null;
      this.error = null;
      this.deployState = "idle";
      task.startUploading();
      try {
        const result = await ipc.githubSync(cfg, (p) => {
          if (!mine()) return;
          if (detached()) task.updateProgress(p);
          else {
            this.progress = p;
            task.updateProgress(p);
          }
        });
        if (!mine()) return;
        // 后台完成:结果只进任务(不写入当前打开的另一个站点),药丸栏转为完成态
        task.result = result;
        task.finish("done");
        if (!detached()) this.result = result;
        // 发布成功:系统通知(按设置档位),并自动监听 Pages 构建
        this.notifyOf("published");
        void this.watchDeploy(cfg, result);
      } catch (e) {
        const msg = ipc.errText(e);
        if (!mine()) return;
        if (msg === "publish-cancelled") {
          // 用户取消:不是错误。站点引用要么未变更,要么已由后端回退
          log("info", t("publish.cancelledLog"));
          task.finish("cancelled");
          if (!detached()) ui.toast(t("publish.cancelledToast"), "info");
        } else {
          task.error = msg;
          log("error", msg);
          task.finish("failed");
          if (!detached()) {
            this.error = msg;
            ui.toast(msg, "error");
          }
        }
      } finally {
        void ipc.githubPublishEnd();
        this.syncing = false;
        this.progress = null;
      }
    },

    /**
     * 自动监听 Pages 构建(轮询 pages/builds/latest,上限 3 分钟):
     * 完成 → 亮起「查看站点」并弹出提示;失败/超时 → 相应提示;
     * 查询异常(网络等)→ 回到待检测,点击按钮时仍会检测。
     * 后台发布切走后状态只进任务,回到发起站点时由 load 恢复。
     */
    async watchDeploy(cfg: GithubConfig, result: SyncResult) {
      const ui = useUiStore();
      const site = useSiteStore();
      const task = usePublishTaskStore();
      const t = i18n.global.t;
      // 发起监听时的任务归属快照:期间用户发起新的发布(任务被覆盖)则停止监听
      const taskRoot = task.siteRoot;
      const mine = () => task.active && task.siteRoot === taskRoot;
      const detached = () => site.root !== taskRoot;
      if (task.deployState === "building") return;
      task.setDeployState("building");
      if (!detached()) this.deployState = "building";
      task.appendLog("info", t("publish.logWatchDeploy"));
      const url = result.customDomain ? `https://${result.customDomain}` : result.pagesUrl;
      const deadline = Date.now() + 180_000;
      try {
        while (Date.now() < deadline) {
          const st = await ipc.githubPagesStatus(cfg, result.commitSha);
          if (!mine()) return;
          if (st.ready) {
            task.setDeployState("ready");
            if (!detached()) this.deployState = "ready";
            task.appendLog("success", t("publish.deployReadyToast"));
            if (!detached()) ui.toast(t("publish.deployReadyToast"), "success");
            this.notifyOf("deployed", url);
            return;
          }
          if (st.errored) {
            task.setDeployState("errored");
            if (!detached()) this.deployState = "errored";
            task.appendLog("error", t("publish.deployErrored"));
            if (!detached()) ui.toast(t("publish.deployErrored"), "error");
            return;
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
        task.setDeployState("timeout");
        if (!detached()) this.deployState = "timeout";
        task.appendLog("info", t("publish.deployTimeout"));
        if (!detached()) ui.toast(t("publish.deployTimeout"), "info");
      } catch {
        task.setDeployState("idle");
        if (!detached()) this.deployState = "idle";
        task.appendLog("info", t("publish.deployWatchFailed"));
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
