import { defineStore } from "pinia";
import { ipc } from "@/ipc/ipc";
import { Events, listen } from "@/ipc/events";
import type { LanPeer, LanProgress, LanPushPlan, LanStatus } from "@/ipc/types";
import { i18n } from "@/i18n";
import { useUiStore } from "./ui";
import { useAppStore } from "./app";

/** 传输对话框的阶段:准备 → 请求对方确认 → 传输 → 完成/出错 */
export type LanTransferStep = "prepare" | "request" | "transfer" | "done" | "error";

export interface LanTransfer {
  open: boolean;
  direction: "send" | "pull";
  /** 对端设备(发送/拉取的目标) */
  peer: LanPeer;
  peerName: string;
  peerPlatform: string;
  siteName: string;
  step: LanTransferStep;
  error: string;
  /** 拉取落盘的站点名(可能与请求名不同:副本自动改名) */
  resultSite?: string;
}

interface LanState {
  status: LanStatus | null;
  scanning: boolean;
  peers: LanPeer[];
  /** 收到的推送计划(非信任网络下等用户决定) */
  incoming: LanPushPlan | null;
  /** 推送/拉取对话框 */
  transfer: LanTransfer | null;
}

export const useLanStore = defineStore("lan", {
  state: (): LanState => ({
    status: null,
    scanning: false,
    peers: [],
    incoming: null,
    transfer: null,
  }),

  getters: {
    running: (s) => s.status?.running ?? false,
    trusted: (s) => s.status?.trusted ?? false,
    deviceName: (s) => s.status?.deviceName ?? "",
    busy: (s) => s.transfer !== null && s.transfer.open && s.transfer.step !== "done" && s.transfer.step !== "error",
  },

  actions: {
    /** 应用启动时调用:按设置恢复服务并挂事件监听 */
    async init() {
      await this.refreshStatus();
      await listen<LanPushPlan>(Events.LanIncoming, (plan) => {
        this.incoming = plan;
      });
      await this.watchReceived();
      await listen<void>(Events.LanRejected, () => {
        void this.scan();
      });
    },

    async refreshStatus() {
      try {
        this.status = await ipc.lanServiceStatus();
      } catch {
        this.status = null;
      }
    },

    /** 接收完成提示:HTTP 线程落盘完成后发来带 site 的进度事件 */
    async watchReceived() {
      await listen<LanProgress>(Events.LanProgress, (p) => {
        if (p.direction === "receive" && p.site) {
          void useUiStore().toast(i18n.global.t("lan.received", { site: p.site }));
        }
      });
    },

    async start() {
      const app = useAppStore();
      const status = await ipc.lanStartService(app.settings.lanDeviceName, app.settings.lanTrusted);
      this.status = status;
      await app.setLanPrefs({ lanEnabled: true });
    },

    async stop() {
      this.status = await ipc.lanStopService();
      this.peers = [];
      await useAppStore().setLanPrefs({ lanEnabled: false });
    },

    async setTrusted(trusted: boolean) {
      if (!this.running) return;
      this.status = await ipc.lanUpdateMeta(undefined, trusted);
      await useAppStore().setLanPrefs({ lanTrusted: trusted });
    },

    async setDeviceName(name: string) {
      if (!this.running) {
        await useAppStore().setLanPrefs({ lanDeviceName: name });
        return;
      }
      this.status = await ipc.lanUpdateMeta(name, undefined);
      await useAppStore().setLanPrefs({ lanDeviceName: name });
    },

    /** 扫描局域网设备(约 1s,阻塞返回) */
    async scan() {
      if (this.scanning) return;
      this.scanning = true;
      try {
        this.peers = await ipc.lanDiscover();
      } finally {
        this.scanning = false;
      }
    },

    /* ---------- 发送:把一个站点推送到对方 ---------- */

    /** 打开发送对话框(站点名 = 发送源;桌面默认当前站点) */
    beginSend(peer: LanPeer, siteName: string) {
      this.transfer = {
        open: true,
        direction: "send",
        peer,
        peerName: peer.name || peer.ip,
        peerPlatform: peer.platform,
        siteName,
        step: "prepare",
        error: "",
      };
    },

    /** 执行推送(对话框内点击「开始传输」后调用);siteRoot 为发送源站点根目录 */
    async sendSite(peer: LanPeer, siteRoot: string) {
      if (!this.transfer) return;
      const t = i18n.global.t;
      try {
        this.transfer.step = "request";
        const applied = await ipc.lanPushSite(peer, siteRoot);
        this.transfer.step = "done";
        this.transfer.resultSite = applied;
        void useUiStore().toast(t("lan.sendDone", { site: applied, device: peer.name || peer.ip }));
      } catch (e) {
        this.transfer.step = "error";
        this.transfer.error = lanErrorText(ipc.errText(e));
      }
    },

    /* ---------- 拉取:从对方取一个站点 ---------- */

    beginPull(peer: LanPeer, siteName: string) {
      this.transfer = {
        open: true,
        direction: "pull",
        peer,
        peerName: peer.name || peer.ip,
        peerPlatform: peer.platform,
        siteName,
        step: "prepare",
        error: "",
      };
    },

    async pullSite(peer: LanPeer, siteName: string, mode: "copy" | "replace") {
      if (!this.transfer) return;
      const t = i18n.global.t;
      try {
        this.transfer.step = "transfer";
        const applied = await ipc.lanPullSite(peer, siteName, mode);
        this.transfer.step = "done";
        this.transfer.resultSite = applied;
        void useUiStore().toast(t("lan.pullDone", { site: applied }));
      } catch (e) {
        this.transfer.step = "error";
        this.transfer.error = lanErrorText(ipc.errText(e));
      }
    },

    closeTransfer() {
      this.transfer = null;
    },

    /* ---------- 接收:决定收到的推送 ---------- */

    /** 接受推送:copy = 另存副本(默认) / replace = 覆盖同名(自动备份) */
    async acceptIncoming(mode: "copy" | "replace") {
      const t = i18n.global.t;
      const plan = this.incoming;
      this.incoming = null;
      if (!plan) return;
      const accepted = await ipc.lanDecideIncoming(true, mode);
      if (accepted) {
        void useUiStore().toast(t("lan.receiving", { site: plan.siteName }));
      }
    },

    async rejectIncoming() {
      this.incoming = null;
      await ipc.lanDecideIncoming(false, "copy");
    },
  },
});

/** LAN 错误码 → 文案(未知错误原样展示) */
function lanErrorText(err: string): string {
  const t = i18n.global.t;
  const known: Record<string, string> = {
    "lan-not-running": t("lan.errNotRunning"),
    untrusted: t("lan.errUntrusted"),
    busy: t("lan.errBusy"),
    "no-decision": t("lan.errNoDecision"),
    "no-site": t("lan.errNoSite"),
    "bad-session": t("lan.errBadSession"),
    "transfer-failed": t("lan.errTransfer"),
    "lan-connect": t("lan.errConnect"),
  };
  for (const [code, text] of Object.entries(known)) {
    if (err.includes(code)) return text;
  }
  return err;
}
