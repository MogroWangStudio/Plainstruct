/** 安卓侧滑/返回键支持 —— 基于历史栈的统一返回分发。
 *
 * 原理:安卓 WebView 的系统返回在手势触发时若 WebView 可后退则触发
 * history 回退(popstate),否则退出应用。因此每个「可返回的层」都在打开时
 * pushState 一条记录,popstate 时按 LIFO 分发:
 *   1. 浮层(抽屉/弹窗/全屏预览) —— 关闭最上层浮层;
 *   2. 应用视图(设置/发布/主题…) —— 回到上一个视图;
 *   3. 都没有 —— 历史也到了底,下一次返回由系统结束应用(标准安卓行为)。
 *
 * 视图栈与历史条目严格 1:1:UI 前进导航 pushState,UI 返回/关闭浮层用
 * history.back() 消耗记录并置 ignorePop 跳过那次 popstate;系统返回手势
 * 消耗记录后,对应的 release 不再回退历史。
 *
 * 桌面平台全部调用点为 no-op(直接改视图状态,不触碰 history)。 */

import { onScopeDispose, watch, type WatchSource } from "vue";
import { useAppStore, type AppView } from "@/stores/app";
import { isMobilePlatform } from "@/lib/platform";interface BackTarget {
  close: () => void;
  consumed: boolean;
}

const targets: BackTarget[] = [];
/** 视图栈(与历史条目 1:1;栈底是应用启动视图) */
const viewStack: AppView[] = [];
/** UI 主动回退历史时,跳过随之而来的那次 popstate */
let ignorePop = false;
let installed = false;

function pushHistory() {
  history.pushState({ psBack: Date.now() }, "");
}

function backHistory() {
  ignorePop = true;
  history.back();
}

/** 安装 popstate 分发(仅移动平台;应用启动时调用一次) */
export function installBackGesture() {
  if (installed || !isMobilePlatform.value) return;
  installed = true;
  viewStack.push(useAppStore().view);
  // 兜底同步:绕过 navigateView 的视图变化(开站后跳编辑器、发布药丸跳发布页等)
  // 也要保持视图栈与历史条目 1:1,否则系统返回会错位
  watch(
    () => useAppStore().view,
    (view) => {
      const top = viewStack[viewStack.length - 1];
      if (view === top) return;
      if (viewStack.length > 1 && viewStack[viewStack.length - 2] === view) {
        viewStack.pop();
        return;
      }
      if (view === "editor") {
        // 开站/回工作区:视为回到根视图,清空回退深度
        viewStack.length = 0;
        viewStack.push("editor");
        return;
      }
      viewStack.push(view);
      pushHistory();
    },
  );
  window.addEventListener("popstate", () => {
    if (ignorePop) {
      ignorePop = false;
      return;
    }
    const top = targets[targets.length - 1];
    if (top) {
      // 系统返回已弹出该浮层的历史记录:标记已消费并关闭,release 不再回退历史
      targets.pop();
      top.consumed = true;
      top.close();
      return;
    }
    // 视图层返回:弹栈回到上一视图(栈底时不动,下次返回由系统结束应用)
    if (viewStack.length > 1) {
      viewStack.pop();
      const previous = viewStack[viewStack.length - 1];
      useAppStore().setView(previous);
    }
  });
}

/** UI 前进导航:桌面 = 直接切换;移动 = 切换 + 压栈 + pushState。
 *  目标视图恰为上一视图时按返回语义处理(弹栈 + 回退历史,避免越走越深)。 */
export function navigateView(view: AppView) {
  const app = useAppStore();
  if (!isMobilePlatform.value) {
    app.setView(view);
    return;
  }
  if (viewStack[viewStack.length - 1] === view) return;
  if (viewStack.length > 1 && viewStack[viewStack.length - 2] === view) {
    viewStack.pop();
    app.setView(view);
    backHistory();
    return;
  }
  viewStack.push(view);
  app.setView(view);
  pushHistory();
}

/** UI 返回按钮:回到上一视图(移动端弹栈并回退历史;桌面回到编辑器) */
export function navigateBack() {
  const app = useAppStore();
  if (!isMobilePlatform.value) {
    app.setView("editor");
    return;
  }
  if (viewStack.length > 1) {
    viewStack.pop();
    app.setView(viewStack[viewStack.length - 1]);
    backHistory();
  } else {
    app.setView("editor");
  }
}

/** 注册一个「系统返回时关闭」的浮层:打开时调用,返回 release(关闭时调用)。
 *  浮层以任意方式关闭都必须调用 release;系统返回已消耗其历史记录时
 *  release 不会再回退历史。桌面平台为 no-op。 */
export function registerBackTarget(close: () => void): () => void {
  if (!isMobilePlatform.value) return () => undefined;
  const target: BackTarget = { close, consumed: false };
  targets.push(target);
  pushHistory();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = targets.indexOf(target);
    if (index >= 0) targets.splice(index, 1);
    if (!target.consumed) backHistory();
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
