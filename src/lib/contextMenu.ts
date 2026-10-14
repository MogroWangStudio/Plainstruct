/** 右键菜单 -- 全局禁用原生 WebView 菜单,按上下文弹出软件专属菜单(文本操作/文件操作)。
 *  组件级菜单(如文件树)在自己的 contextmenu 处理器里 preventDefault + stopPropagation 后
 *  调用 useContextMenuStore().show();其余区域由本模块兜底:可编辑目标给文本菜单,
 *  有选区文本给复制菜单,否则仅阻止原生菜单。 */
import type { EditorView } from "@codemirror/view";
import { i18n } from "@/i18n";
import { ipc } from "@/ipc/ipc";
import { useAppStore } from "@/stores/app";
import { useContextMenuStore, type MenuItem } from "@/stores/contextMenu";

/* ---------- CodeMirror 实例注册表(编辑器组件挂载时注册) ---------- */

const cmViews = new Map<HTMLElement, EditorView>();
/** 各编辑器自绘「查找与替换」面板的打开函数(右键菜单项调用) */
const cmFindHandlers = new Map<HTMLElement, () => void>();

export function registerCmView(host: HTMLElement, view: EditorView) {
  cmViews.set(host, view);
}

export function unregisterCmView(host: HTMLElement) {
  cmViews.delete(host);
}

/** 注册编辑器的查找面板入口(编辑器组件挂载时调用) */
export function registerCmFind(host: HTMLElement, open: () => void) {
  cmFindHandlers.set(host, open);
}

export function unregisterCmFind(host: HTMLElement) {
  cmFindHandlers.delete(host);
}

function cmViewFor(target: HTMLElement): EditorView | null {
  for (const [host, view] of cmViews) {
    if (host.contains(target)) return view;
  }
  return null;
}

function cmFindFor(target: HTMLElement): (() => void) | null {
  for (const [host, open] of cmFindHandlers) {
    if (host.contains(target)) return open;
  }
  return null;
}

/* ---------- 文案与快捷键 ---------- */

function t(key: string): string {
  return i18n.global.t(key);
}

function modKey(): string {
  return useAppStore().platform === "macos" ? "⌘" : "Ctrl+";
}

/* ---------- 可编辑目标辅助 ---------- */

type FieldElement = HTMLInputElement | HTMLTextAreaElement;

function isField(el: HTMLElement): el is FieldElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

function selectionText(): string {
  return window.getSelection()?.toString() ?? "";
}

function fieldSelection(el: FieldElement): string {
  const { selectionStart, selectionEnd, value } = el;
  return selectionStart !== null && selectionEnd !== null ? value.slice(selectionStart, selectionEnd) : "";
}

/** 向 input/textarea 选区插入文本,并保证派发 input 事件(v-model 同步) */
function insertIntoField(el: FieldElement, text: string) {
  if (!document.execCommand("insertText", false, text)) {
    const { selectionStart, selectionEnd } = el;
    if (selectionStart === null || selectionEnd === null) return;
    el.setRangeText(text, selectionStart, selectionEnd, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/* ---------- 菜单构建 ---------- */

/** 文本操作四件套(剪切/复制/粘贴/全选),作用于 CodeMirror 选区 */
function cmMenuItems(view: EditorView, clipboard: string): MenuItem[] {
  const mod = modKey();
  const sel = view.state.selection.main;
  const text = sel.empty ? "" : view.state.sliceDoc(sel.from, sel.to);
  return [
    {
      id: "cut",
      label: t("menu.cut"),
      icon: "scissors",
      shortcut: `${mod}X`,
      disabled: sel.empty,
      run: () => {
        void ipc.writeClipboardText(text);
        view.dispatch(view.state.replaceSelection(""));
        view.focus();
      },
    },
    {
      id: "copy",
      label: t("menu.copy"),
      icon: "copy",
      shortcut: `${mod}C`,
      disabled: sel.empty,
      run: () => void ipc.writeClipboardText(text),
    },
    {
      id: "paste",
      label: t("menu.paste"),
      icon: "clipboard",
      shortcut: `${mod}V`,
      disabled: !clipboard,
      run: () => {
        view.dispatch(view.state.replaceSelection(clipboard));
        view.focus();
      },
    },
    {
      id: "selectAll",
      label: t("menu.selectAll"),
      icon: "checkSquare",
      shortcut: `${mod}A`,
      run: () => {
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        view.focus();
      },
    },
  ];
}

/** 文本操作四件套,作用于 input/textarea/contenteditable */
function fieldMenuItems(el: HTMLElement, clipboard: string): MenuItem[] {
  const mod = modKey();
  const field = isField(el) ? el : null;
  const selected = field
    ? fieldSelection(field)
    : el.contains(window.getSelection()?.anchorNode ?? null)
      ? selectionText()
      : "";
  return [
    {
      id: "cut",
      label: t("menu.cut"),
      icon: "scissors",
      shortcut: `${mod}X`,
      disabled: !selected,
      run: () => {
        el.focus();
        if (field) {
          void ipc.writeClipboardText(fieldSelection(field));
          if (!document.execCommand("delete")) insertIntoField(field, "");
        } else {
          document.execCommand("cut");
        }
      },
    },
    {
      id: "copy",
      label: t("menu.copy"),
      icon: "copy",
      shortcut: `${mod}C`,
      disabled: !selected,
      run: () => {
        void ipc.writeClipboardText(field ? fieldSelection(field) : selectionText());
      },
    },
    {
      id: "paste",
      label: t("menu.paste"),
      icon: "clipboard",
      shortcut: `${mod}V`,
      disabled: !clipboard,
      run: () => {
        el.focus();
        if (field) insertIntoField(field, clipboard);
        else document.execCommand("insertText", false, clipboard);
      },
    },
    {
      id: "selectAll",
      label: t("menu.selectAll"),
      icon: "checkSquare",
      shortcut: `${mod}A`,
      run: () => {
        el.focus();
        if (field) field.select();
        else document.execCommand("selectAll");
      },
    },
  ];
}

/* ---------- 全局安装 ---------- */

function openMenuAt(e: MouseEvent, items: MenuItem[]): boolean {
  const menu = useContextMenuStore();
  if (items.length) {
    menu.show(e.clientX, e.clientY, items);
    return true;
  }
  return false;
}

/** 在 App 挂载后调用一次:全局接管 contextmenu 事件 */
export function installContextMenu() {
  window.addEventListener("contextmenu", (e) => {
    // 统一禁用原生 WebView 右键菜单
    e.preventDefault();
    const menu = useContextMenuStore();
    const target = e.target;
    if (!(target instanceof HTMLElement)) {
      menu.close();
      return;
    }

    const cm = cmViewFor(target);
    if (cm) {
      const openFind = cmFindFor(target);
      void ipc.readClipboardText().then((clipboard) => {
        const items = cmMenuItems(cm, clipboard);
        // 查找与替换:编辑器提供自绘面板时才出现在菜单里(置于文本操作之前)
        if (openFind) {
          items.unshift(
            { id: "find", label: t("menu.find"), icon: "search", shortcut: `${modKey()}F`, run: () => openFind() },
            { id: "find-sep", separator: true },
          );
        }
        openMenuAt(e, items);
      });
      return;
    }

    const editable = target.closest<HTMLElement>("input, textarea, [contenteditable='true']");
    if (editable) {
      void ipc.readClipboardText().then((clipboard) => {
        openMenuAt(e, fieldMenuItems(editable, clipboard));
      });
      return;
    }

    // 非编辑区域:有选中文本时提供复制,否则关闭已打开的菜单
    if (selectionText()) {
      openMenuAt(e, selectionMenu());
      return;
    }
    menu.close();
  });
}

/** 普通文本选区菜单 */
function selectionMenu(): MenuItem[] {
  return [
    {
      id: "copy",
      label: t("menu.copy"),
      icon: "copy",
      run: () => void ipc.writeClipboardText(selectionText()),
    },
  ];
}
