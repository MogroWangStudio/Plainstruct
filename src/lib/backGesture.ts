/** 安卓侧滑/返回键支持 —— 基于历史栈的统一返回分发。
 *
 * 原理:安卓 WebView 的系统返回在手势触发时若 WebView 可后退则触发
 * history 回退(popstate),否则退出应用。因此每一层「可返回的东西」在打开时
 * pushState 一条记录并压入同一个栈,popstate 时按 LIFO 关闭:
 *   1. 浮层(抽屉/弹窗/全屏预览) —— 关闭最上层浮层;
 *   2. 应用视图(设置/发布/主题…) —— 回到上一层视图;
 *   3. 站点工作区 —— 收起站点回到主菜单(而不是直接退出应用)。
 * 栈空了,下一次返回由系统结束应用(标准安卓行为)。
 *
 * 栈与历史条目严格 1:1:前进导航 pushState,UI 主动返回用 history.go(-n) 消耗记录
 * 并跳过随之而来的 popstate;系统返回已消耗的记录不会再被回退。
 *
 * 桌面平台全部调用点为 no-op(直接改视图状态,不触碰 history)。 */

import { onScopeDispose, watch, type WatchSource } from "vue";
import { useAppStore, type AppView } from "@/stores/app";
import { useSiteStore } from "@/stores/site";
import { isMobilePlatform } from "@/lib/platform";

type StepKind = "overlay" | "view" | "site";

interface Step {
  kind: StepKind;
  /** 视图层要回到的目标视图 */
  view?: AppView;
  /** 关闭 / 回退这一层 */
  close: () => void;
  /** 历史记录已被系统返回消耗,释放时不再回退 */
  consumed: boolean;
}

/** 统一返回栈(与历史条目 1:1;栈底是应用启动状态) */
const steps: Step[] = [];
/** UI 主动回退历史时,需要跳过的 popstate 次数 */
let ignorePops = 0;
let installed = false;
/** 由本模块驱动的视图切换:watcher 不再重复补栈 */
let expectedView: AppView | null = null;

function pushHistory() {
  history.pushState({ psBack: Date.now() }, "");
}

/** 吃掉 n 条历史记录(无对应返回层时用) */
function consumeHistory(n = 1) {
  if (n <= 0) return;
  ignorePops += 1;
  history.go(-n);
}

function setViewQuiet(view: AppView) {
  // 视图没有实际变化时不要留下「待跳过」标记,否则会吞掉下一次兜底补栈
  const app = useAppStore();
  if (app.view === view) return;
  expectedView = view;
  app.setView(view);
}

function lastStep(kind?: StepKind): Step | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (!kind || steps[i].kind === kind) return steps[i];
  }
  return undefined;
}

/** 倒数第二个视图层(判断「目标恰为上一层」用) */
function previousViewStep(): Step | undefined {
  let seen = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].kind !== "view") continue;
    seen += 1;
    if (seen === 2) return steps[i];
  }
  return undefined;
}

/** 摘下并关闭栈内某一层(历史记录已由调用方处理) */
function popStep(): Step | undefined {
  const step = steps.pop();
  if (!step) return undefined;
  step.consumed = true;
  step.close();
  return step;
}

/** 安装 popstate 分发(仅移动平台;应用启动时调用一次) */
export function installBackGesture() {
  if (installed || !isMobilePlatform.value) return;
  installed = true;
  const app = useAppStore();
  const site = useSiteStore();

  // 站点开合也是一层:打开站点后可返回主菜单,而不是直接退出应用
  watch(
    () => site.open,
    (open) => {
      if (open) {
        steps.push({
          kind: "site",
          consumed: false,
          close: () => {
            void site.close();
            setViewQuiet("editor");
          },
        });
        pushHistory();
        return;
      }
      // UI 关闭站点:摘掉站点层并消耗其记录
      const step = lastStep("site");
      if (!step) return;
      steps.splice(steps.indexOf(step), 1);
      if (!step.consumed) consumeHistory(1);
    },
    { flush: "post" },
  );

  // 兜底同步:绕过 navigateView 的视图变化(发布药丸跳发布页、开站后跳编辑器等)
  // 也要保持栈与历史条目 1:1,否则系统返回会错位
  watch(
    () => app.view,
    (view, from) => {
      if (expectedView === view) {
        expectedView = null;
        return;
      }
      if (lastStep("view")?.view === view) return;
      if (view === "editor") {
        // 回到工作区根:视图层一并清空(记录随之吃掉)
        let dropped = 0;
        for (let i = steps.length - 1; i >= 0; i--) {
          if (steps[i].kind !== "view") continue;
          steps.splice(i, 1);
          dropped += 1;
        }
        consumeHistory(dropped);
        return;
      }
      const back: AppView = from ?? "editor";
      steps.push({ kind: "view", view, consumed: false, close: () => setViewQuiet(back) });
      pushHistory();
    },
  );

  window.addEventListener("popstate", () => {
    if (ignorePops > 0) {
      ignorePops -= 1;
      return;
    }
    // 系统返回已弹出该层的历史记录:标记已消费后关闭,不再回退历史
    popStep();
  });
}

/** UI 前进导航:桌面 = 直接切换;移动 = 切换 + 压栈 + pushState。
 *  目标视图恰为上一层视图时按返回语义处理(弹栈 + 回退历史,避免越走越深)。 */
export function navigateView(view: AppView) {
  const app = useAppStore();
  if (!isMobilePlatform.value) {
    app.setView(view);
    return;
  }
  if (lastStep("view")?.view === view) return;
  const from = app.view;
  if (previousViewStep()?.view === view) {
    setViewQuiet(view);
    const step = lastStep("view");
    if (step) {
      steps.splice(steps.indexOf(step), 1);
      step.consumed = true;
      consumeHistory(1);
    }
    return;
  }
  steps.push({ kind: "view", view, consumed: false, close: () => setViewQuiet(from) });
  setViewQuiet(view);
  pushHistory();
}

/** UI 返回按钮:关闭栈顶一层(浮层 → 视图 → 站点);桌面回到编辑器 */
export function navigateBack() {
  const app = useAppStore();
  if (!isMobilePlatform.value) {
    app.setView("editor");
    return;
  }
  const step = steps[steps.length - 1];
  if (!step) {
    app.setView("editor");
    return;
  }
  popStep();
  consumeHistory(1);
}

/** 返回主菜单:收起站点工作区(含其上的全部视图层),回到启动页 */
export function goToMenu() {
  const site = useSiteStore();
  if (!isMobilePlatform.value) {
    void site.close();
    return;
  }
  const index = steps.findIndex((s) => s.kind === "site");
  if (index < 0) {
    setViewQuiet("editor");
    return;
  }
  const removed = steps.splice(index);
  void site.close();
  setViewQuiet("editor");
  consumeHistory(removed.filter((s) => !s.consumed).length);
}

/** 注册一个「系统返回时关闭」的浮层:打开时调用,返回 release(关闭时调用)。
 *  浮层以任意方式关闭都必须调用 release;系统返回已消耗其历史记录时
 *  release 不会再回退历史。桌面平台为 no-op。 */
export function registerBackTarget(close: () => void): () => void {
  if (!isMobilePlatform.value) return () => undefined;
  const step: Step = { kind: "overlay", consumed: false, close };
  steps.push(step);
  pushHistory();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = steps.indexOf(step);
    if (index >= 0) steps.splice(index, 1);
    if (!step.consumed) consumeHistory(1);
  };
}

/** 响应式浮层的返回关闭:open 变 true 时注册,变 false 时释放。
 *  组件卸载时若仍打开会自动释放。 */
export function useBackClose(open: WatchSource<boolean>, close: () => void) {
  let release: (() => void) | null = null;
  watch(open, (isOpen) => {
    if (isOpen && !release) {
      release = registerBackTarget(close);
    } else if (!isOpen && release) {
      release();
      release = null;
    }
  });
  onScopeDispose(() => {
    release?.();
    release = null;
  });
}
