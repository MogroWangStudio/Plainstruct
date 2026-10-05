<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, reactive, ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import type { TreeNode } from "@/ipc/types";
import { useSiteStore } from "@/stores/site";
import { useEditorStore } from "@/stores/editor";
import { useAppStore } from "@/stores/app";
import { useUiStore } from "@/stores/ui";
import { useBuilderStore } from "@/stores/builder";
import { useContextMenuStore, type MenuItem } from "@/stores/contextMenu";
import { ipc } from "@/ipc/ipc";
import { applyFrontMatter, parseFrontMatter } from "@/lib/frontmatter";
import NewDocModal from "@/components/NewDocModal.vue";
import FrontMatterModal, { type FrontMatterForm } from "@/components/FrontMatterModal.vue";
import { ASSET_MIME, basename, dirname, isImageFile, safeName, stripExt } from "@/lib/paths";
import { siteUrl } from "@/lib/preview";
import { toCssPx } from "@/lib/scale";
import AppIcon from "./AppIcon.vue";
import FileTreeNode, { type DropMark, type SelectClick } from "./FileTreeNode.vue";
import PromptModal from "./PromptModal.vue";

const { t } = useI18n();
const site = useSiteStore();
const editor = useEditorStore();
const app = useAppStore();
const ui = useUiStore();
const ctxMenu = useContextMenuStore();

const collapsed = ref(new Set<string>());
provide("treeCollapsed", collapsed);

/** 拖拽落点指示(行插入线 / 移入文件夹 / 根目录末尾) */
const dropMark = ref<DropMark>(null);
provide("treeDropMark", dropMark);

/** 过滤掉根级 index.md(独立首页入口)与资产目录(下方资产栏),其余保持不变 */
const displayTree = computed(() =>
  site.tree.filter(
    (n) =>
      !(n.type === "file" && n.name.toLowerCase() === "index.md") &&
      !(n.type === "dir" && site.assetDirs.includes(n)),
  ),
);

/* ---------- 资产栏:站点图片资源区(卡片/列表视图),图片可拖入正文 ---------- */

/** 资产栏高度(顶缘分隔线可拖,120–420px);界面缩放档位下指针坐标经 toCssPx 还原 */
const assetH = ref(218);
const treeHost = ref<HTMLElement | null>(null);

function onAssetDividerDown(e: PointerEvent) {
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onAssetDividerMove(e: PointerEvent) {
  if (!(e.buttons & 1) || !treeHost.value) return;
  const host = treeHost.value.getBoundingClientRect();
  assetH.value = Math.min(420, Math.max(120, toCssPx(host.bottom - e.clientY)));
}

const assetView = ref<"card" | "list">("card");
const brokenThumbs = ref(new Set<string>());

function assetThumb(path: string): string {
  // 浏览器 mock 无 site:// 资源服务:返回空让占位文字顶上
  return app.platform === "browser" ? "" : siteUrl(app.platform, `content/${path}`);
}

/** 拖动开始:载荷为 content/ 相对路径,编辑器 drop 时换算相对引用 */
function onAssetDragStart(e: DragEvent, img: TreeNode) {
  e.dataTransfer?.setData(ASSET_MIME, img.path);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
}

/** 拖拽中实际移动的路径集合(多选拖拽 = 全部选中项),供各行整体淡化 */
const draggingPaths = ref<Set<string> | null>(null);
provide("treeDragging", draggingPaths);
provide("treeSetDragging", setDragging);

/* ---------- 固定首页入口 ---------- */

const homeNode = computed(() => site.findDoc("index.md"));
const homeActive = computed(
  () => !!editor.activePath && editor.activePath.toLowerCase() === "index.md",
);

/** 编辑首页;根目录没有 index.md 时创建一篇 */
async function openHomepage() {
  if (homeNode.value) {
    await editor.openDoc(homeNode.value);
    return;
  }
  try {
    await site.createDoc("", "index", t("tree.homeDocTitle"));
    ui.toast(t("tree.homeCreated"), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

/* ---------- 多选模式 ---------- */

const selectMode = ref(false);
const selectedPaths: Ref<Set<string>> = ref(new Set());
provide("treeSelected", selectedPaths);

const selectedCount = computed(() => selectedPaths.value.size);
/** Shift 范围选择的起点 */
const anchor = ref<string | null>(null);

/** 树的扁平显示顺序(范围选择用) */
function flattenPaths(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      out.push(n.path);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function setSelectMode(on: boolean) {
  selectMode.value = on;
  anchor.value = null;
  if (!on) selectedPaths.value = new Set();
}

/** 多选模式下的行点击:普通 = 单选,Ctrl/⌘ = 切换,Shift = 从锚点范围选择 */
function handleSelectClick(click: SelectClick) {
  if (click.shift && anchor.value) {
    const flat = flattenPaths(displayTree.value);
    const a = flat.indexOf(anchor.value);
    const b = flat.indexOf(click.path);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      selectedPaths.value = new Set(flat.slice(lo, hi + 1));
      return;
    }
  }
  if (click.ctrl) {
    anchor.value = click.path;
    const next = new Set(selectedPaths.value);
    if (next.has(click.path)) next.delete(click.path);
    else next.add(click.path);
    selectedPaths.value = next;
    return;
  }
  anchor.value = click.path;
  selectedPaths.value = new Set([click.path]);
}

/* ---------- 框选(空白处按下拖动) ---------- */

const scrollEl = ref<HTMLElement | null>(null);
/** 选框矩形,内容坐标 */
const band = ref<{ x: number; y: number; w: number; h: number } | null>(null);
let bandStart: { x: number; y: number } | null = null;
let bandPointerId = -1;

function onBandDown(e: PointerEvent) {
  if (!selectMode.value || e.button !== 0) return;
  if ((e.target as HTMLElement | null)?.closest(".tree-row, button")) return;
  bandStart = { x: e.clientX, y: e.clientY };
  bandPointerId = e.pointerId;
  scrollEl.value?.setPointerCapture(e.pointerId);
}

function onBandMove(e: PointerEvent) {
  if (!bandStart || e.pointerId !== bandPointerId || !scrollEl.value) return;
  // 位移阈值:越过前视为原地点击,不进入框选
  if (!band.value && Math.abs(e.clientX - bandStart.x) < 4 && Math.abs(e.clientY - bandStart.y) < 4) return;
  const el = scrollEl.value;
  const rect = el.getBoundingClientRect();
  const left = Math.min(bandStart.x, e.clientX);
  const top = Math.min(bandStart.y, e.clientY);
  const right = Math.max(bandStart.x, e.clientX);
  const bottom = Math.max(bandStart.y, e.clientY);
  band.value = {
    x: left - rect.left + el.scrollLeft,
    y: top - rect.top + el.scrollTop,
    w: right - left,
    h: bottom - top,
  };
  // 与行矩形相交即选中
  const next = new Set<string>();
  el.querySelectorAll<HTMLElement>(".tree-row").forEach((row) => {
    const r = row.getBoundingClientRect();
    if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) {
      const p = row.dataset.path;
      if (p) next.add(p);
    }
  });
  selectedPaths.value = next;
}

function onBandUp(e: PointerEvent) {
  if (e.pointerId !== bandPointerId) return;
  const banded = band.value !== null;
  bandStart = null;
  bandPointerId = -1;
  band.value = null;
  // 空白处原地点击(未成框) = 清除选择
  if (!banded) selectedPaths.value = new Set();
}

function onBandCancel(e: PointerEvent) {
  if (e.pointerId !== bandPointerId) return;
  bandStart = null;
  bandPointerId = -1;
  band.value = null;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && selectMode.value) setSelectMode(false);
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

function clearSelection() {
  selectedPaths.value = new Set();
}

/* ---------- 收集所有文件夹路径(用于移动目标选择) ---------- */

function collectDirs(): TreeNode[] {
  const dirs: TreeNode[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.type === "dir" && !site.assetDirs.includes(n)) {
        dirs.push(n);
        if (n.children) walk(n.children);
      }
    }
  };
  walk(site.tree);
  return dirs;
}

/* ---------- 批量移动 ---------- */

const showMoveDialog = ref(false);

async function batchMoveTo(targetDir: string) {
  const paths = [...selectedPaths.value];
  let moved = 0;
  for (const src of paths) {
    try {
      await site.moveItem(src, targetDir);
      moved++;
    } catch (e) {
      ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
    }
  }
  if (moved > 0) {
    ui.toast(t("tree.importDone", { n: moved }), "success");
  }
  clearSelection();
  showMoveDialog.value = false;
}

/* ---------- Prompt ---------- */

type Prompt =
  | { mode: "newFolder"; parent: string }
  | { mode: "rename"; node: TreeNode }
  | null;

const prompt = ref<Prompt>(null);

/** 新建文档弹窗(内嵌配置头设置):名称 + 标题/描述/日期/封面一次填好 */
const newDocOpen = ref(false);
const newDocDir = ref("");

const promptTitle = () => (prompt.value?.mode === "newFolder" ? t("tree.newFolder") : t("tree.renameTitle"));

const promptLabel = () => (prompt.value?.mode === "newFolder" ? t("tree.folderName") : t("common.rename"));

const promptInitial = () => {
  const p = prompt.value;
  if (p?.mode === "rename") return p.node.type === "file" ? stripExt(p.node.name) : p.node.name;
  return "";
};

/** 新建文档弹窗确认:创建后把表单里的配置头字段一并写回 */
async function onNewDocConfirm(payload: {
  name: string;
  title: string;
  description: string;
  date: string;
  cover: string;
}) {
  newDocOpen.value = false;
  try {
    // 标题/描述由创建命令写入 front-matter
    await site.createDoc(newDocDir.value, payload.name, payload.title || undefined, payload.description || undefined);
    const editor = useEditorStore();
    if (editor.activePath) {
      // 标题留空时以文档名为准(与创建命令的语义一致)
      const next = applyFrontMatter(editor.content, { ...payload, title: payload.title || payload.name });
      if (next !== editor.content) {
        await ipc.saveDoc(editor.activePath, next);
        site.updateDocCache(editor.activePath, next);
        editor.externalReplace = true;
        editor.content = next;
        editor.savedContent = next;
      }
    }
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

async function onPromptConfirm(value: string) {
  const p = prompt.value;
  prompt.value = null;
  if (!p) return;
  const name = safeName(value);
  try {
    if (p.mode === "newFolder") {
      await site.createFolder(p.parent, name);
    } else {
      await site.renameItem(p.node.path, p.node.type === "file" ? `${name}.md` : name);
    }
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

async function onRemove(node: TreeNode) {
  const isDir = node.type === "dir";
  const ok = await ui.confirmDialog({
    title: isDir ? t("tree.deleteFolderTitle") : t("tree.deleteDocTitle"),
    body: isDir ? t("tree.deleteFolderBody", { name: node.name }) : t("tree.deleteDocBody", { name: node.name }),
    danger: true,
    confirmText: t("common.delete"),
  });
  if (!ok) return;
  try {
    await site.deleteItem(node.path);
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

/* ---------- 右键菜单(文件操作) ---------- */

/** 按路径在完整树中查找节点 */
function findNodeByPath(path: string): TreeNode | null {
  const walk = (nodes: TreeNode[]): TreeNode | null => {
    for (const n of nodes) {
      if (n.path === path) return n;
      const hit = n.children ? walk(n.children) : null;
      if (hit) return hit;
    }
    return null;
  };
  return walk(site.tree);
}

/* ---------- 配置头可视化编辑(文件树右键入口) ---------- */

const fmOpen = ref(false);
const fmTarget = ref("");
/** 主页配置区数据:目标是博客根 index.md 时为候选文章列表,否则 null */
const fmBlogHome = ref<{ posts: { title: string; path: string }[] } | null>(null);
const fmInitial = reactive<FrontMatterForm>({ title: "", description: "", date: "", cover: "", author: "", aigc: "", hidden: false, homeGroups: false, homePosts: [] });

/** 打开配置头表单:当前打开的文档取编辑器内容(含未保存修改),其余读磁盘版本 */
async function openFmEditor(node: TreeNode) {
  const base =
    editor.activePath === node.path
      ? editor.content
      : ((await ipc.readDocs([node.path]))[0] ?? "");
  const parsed = parseFrontMatter(base);
  fmTarget.value = node.path;
  fmInitial.title = parsed.data.title ?? stripExt(node.name);
  fmInitial.description = parsed.data.description ?? "";
  fmInitial.date = parsed.data.date ?? "";
  fmInitial.cover = parsed.data.cover ?? "";
  fmInitial.author = parsed.data.author ?? "";
  fmInitial.aigc = parsed.data.aigc ?? "";
  fmInitial.hidden = parsed.data.hidden === true;
  // 主页配置区预填:已有 homePosts 按其勾选,否则全勾(= 显示全部)
  const opts = site.blogHomePostOptions;
  const isHomeDoc = !!opts && node.path.toLowerCase() === "index.md";
  fmBlogHome.value = isHomeDoc ? { posts: opts } : null;
  fmInitial.homeGroups = isHomeDoc && parsed.data.homeGroups === true;
  fmInitial.homePosts = isHomeDoc ? (parsed.data.homePosts ?? opts!.map((o) => o.path)) : [];
  fmOpen.value = true;
}

/** 确认后写回文档:当前打开的文档经编辑器统一保存路径,其余直接落盘 */
async function onFmConfirm(form: FrontMatterForm) {
  fmOpen.value = false;
  const path = fmTarget.value;
  try {
    const base =
      editor.activePath === path
        ? editor.content
        : ((await ipc.readDocs([path]))[0] ?? "");
    const next = applyFrontMatter(base, form);
    if (next === base) return;
    if (editor.activePath === path) {
      editor.externalReplace = true;
      editor.content = next;
      await editor.save();
    } else {
      await ipc.saveDoc(path, next);
      site.updateDocCache(path, next);
    }
    useBuilderStore().onSiteChanged();
    ui.toast(t("tree.fmSaved"), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

/** 选取本地图片导入站点 asset 文件夹(资产栏导入按钮与右键共用) */
async function importImages() {
  const files = await ipc.pickImages();
  if (!files?.length) return;
  try {
    const names = await site.importSiteImages(files);
    if (names.length) ui.toast(t("tree.importDone", { n: names.length }), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

/** 树内右键:命中行弹出该节点的文件操作,主页行弹出首页操作,空白处弹出根目录操作 */
function openTreeMenu(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  // 主页是固定入口,不在树行内:单独识别,菜单视作 index.md 节点(含编辑配置头)
  const homeRow = target?.closest<HTMLElement>(".home-row") ?? null;
  const row = target?.closest<HTMLElement>(".tree-row") ?? null;
  const node = homeRow
    ? homeNode.value
    : row?.dataset.path
      ? findNodeByPath(row.dataset.path)
      : null;
  const dir = node ? (node.type === "dir" ? node.path : dirname(node.path)) : "";

  const items: MenuItem[] = [
    {
      id: "newDoc",
      label: t("tree.newDoc"),
      icon: "filePlus",
      run: () => {
        newDocDir.value = dir;
        newDocOpen.value = true;
      },
    },
    {
      id: "newFolder",
      label: t("tree.newFolder"),
      icon: "folderPlus",
      run: () => (prompt.value = { mode: "newFolder", parent: dir }),
    },
  ];
  if (node?.type === "dir") {
    items.push({
      id: "import",
      label: t("tree.importToFolder"),
      icon: "download",
      run: () => void onImport(node.path),
    });
  } else if (!node) {
    items.push({
      id: "import",
      label: t("tree.importFiles"),
      icon: "download",
      run: () => void onImport(""),
    });
  }
  if (node) {
    items.push(
      { id: "sep", separator: true },
      {
        id: "rename",
        label: t("tree.rename"),
        icon: "pencil",
        run: () => (prompt.value = { mode: "rename", node }),
      },
      {
        id: "delete",
        label: t("tree.delete"),
        icon: "trash",
        danger: true,
        run: () => void onRemove(node),
      },
    );
    // Markdown 文档可从文件树直接打开配置头表单(图片没有配置头;主页同样可用)
    if (node.type === "file" && !isImageFile(node.path)) {
      items.splice(2, 0, {
        id: "frontmatter",
        label: t("tree.fmEdit"),
        icon: "frontmatter",
        run: () => void openFmEditor(node),
      });
    }
  }

  e.preventDefault();
  e.stopPropagation();
  ctxMenu.show(e.clientX, e.clientY, items);
}

/* ---------- 导入 ---------- */

async function onImport(destDir: string = "") {
  const files = await ipc.pickImportFiles();
  if (!files?.length) return;
  try {
    const n = await site.importFiles(files, destDir);
    ui.toast(t("tree.importDone", { n }), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

/* ---------- 外部文件拖放导入 ---------- */

async function onExternalDrop(e: DragEvent) {
  const files = e.dataTransfer?.files;
  if (!files?.length) return;
  // 过滤出支持的文件类型
  const supported = ["md", "markdown", "png", "jpg", "jpeg", "gif", "webp", "svg"];
  const filePaths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (supported.includes(ext)) {
      // 在 Tauri 环境中,我们可以通过文件路径导入
      // 浏览器 mock 环境则使用 mock 路径
      if (ipc.inTauri) {
        // Tauri 的 File 对象没有 path 属性,需要使用其他方式
        // 对于外部拖放,我们暂时跳过(需要 Tauri 的 dnd 事件支持)
        continue;
      }
      filePaths.push((f as any).path ?? f.name);
    }
  }
  if (!filePaths.length) return;
  try {
    const n = await site.importFiles(filePaths, "");
    ui.toast(t("tree.importDone", { n }), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

/* ---------- 移动(拖拽/批量) ---------- */

/** 拖动 src 实际移动的集合:src 属于多选集合时为全部选中项,并去掉会被祖先带走的后代(框选常同时选中文件夹与其内容) */
function dragSrcs(src: string): string[] {
  if (!selectedPaths.value.has(src) || selectedPaths.value.size <= 1) return [src];
  const paths = [...selectedPaths.value];
  return paths.filter((s) => !paths.some((p) => s.startsWith(p + "/")));
}

/** 再排除目标自身与目标位于某选中项内部的情况(不能把文件夹移进它自己) */
function expandDragSrcs(src: string, destDir: string): string[] {
  return dragSrcs(src).filter(
    (s) => s !== destDir && !(destDir && destDir.startsWith(s + "/")),
  );
}

/** 拖动开始时记录实际移动集合,各行据此整体淡化(拖动结束传 null 复位) */
function setDragging(src: string | null) {
  draggingPaths.value = src ? new Set(dragSrcs(src)) : null;
}

async function onMove(src: string, destDir: string) {
  let moved = 0;
  for (const s of expandDragSrcs(src, destDir)) {
    try {
      await site.moveItem(s, destDir);
      moved++;
    } catch (e) {
      ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
    }
  }
  // 多项移动时统一提示;单项保持安静
  if (moved > 1) ui.toast(t("tree.importDone", { n: moved }), "success");
  if (moved > 0) clearSelection();
}

/* ---------- 手动排序(拖到行上/下边缘) ---------- */

/** 某目录(空串为根)下子项的当前显示名称序列 */
function childNamesOf(dir: string): string[] {
  const children = dir ? findNodeByPath(dir)?.children ?? [] : site.tree;
  return children.map((n) => n.name);
}

/**
 * 拖到某行的前/后:同目录 = 直接重排;跨目录 = 先移动再把新项插入该行前/后。
 * 多选拖动时,选中项按显示顺序成组插入,保持彼此相对顺序。
 */
async function onReorder(src: string, targetPath: string, pos: "before" | "after") {
  const dir = dirname(targetPath);
  const targetName = basename(targetPath);
  const srcs = expandDragSrcs(src, dir);
  const movingNames = srcs.map(basename);
  if (movingNames.includes(targetName)) return;

  try {
    if (dirname(src) === dir) {
      const names = childNamesOf(dir);
      const rest = names.filter((n) => !movingNames.includes(n));
      const at = rest.indexOf(targetName);
      if (at < 0) return;
      rest.splice(pos === "before" ? at : at + 1, 0, ...movingNames);
      await site.saveOrder(dir, rest);
    } else {
      // 跨目录:移动(内部会刷新树),随后把实际落点名称插入目标行前/后
      const movedNames: string[] = [];
      for (const s of srcs) {
        const newPath = await site.moveItem(s, dir);
        movedNames.push(basename(newPath));
      }
      const rest = childNamesOf(dir).filter((n) => !movedNames.includes(n));
      const at = rest.indexOf(targetName);
      if (at < 0) return;
      rest.splice(pos === "before" ? at : at + 1, 0, ...movedNames);
      await site.saveOrder(dir, rest);
    }
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

/* ---------- 树空白区域的拖放(移动到根目录 / 外部导入) ---------- */

function onTreeDragOver(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.types.includes("text/plain")) {
    e.dataTransfer.dropEffect = "move";
  }
  // 落在行外空白处 = 移动到根目录,指示线挂在列表末尾;行内由节点自行标记
  if ((e.target as HTMLElement | null)?.closest?.(".tree-row")) return;
  dropMark.value = { kind: "root-end" };
}

function onTreeDragLeave(e: DragEvent) {
  const el = scrollEl.value;
  if (!el) return;
  if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
  dropMark.value = null;
}

async function onTreeDrop(e: DragEvent) {
  e.preventDefault();
  dropMark.value = null;
  const src = e.dataTransfer?.getData("text/plain");
  if (src) {
    await onMove(src, "");
    return;
  }
  await onExternalDrop(e);
}
</script>

<template>
  <div ref="treeHost" class="flex h-full flex-col" @contextmenu="openTreeMenu">
    <div class="flex items-center justify-between px-3 pb-1 pt-3">
      <span class="text-[calc(12px*var(--ui-font-scale))] font-semibold tracking-wide text-ink-3">
        {{ t("nav.editor") }} · {{ site.docCount }}
      </span>
      <div class="flex items-center gap-0.5">
        <button
          class="select-btn btn-icon !h-7 !w-7"
          :title="t('tree.multiSelect')"
          :aria-pressed="selectMode"
          @click="setSelectMode(!selectMode)"
        >
          <AppIcon name="checkSquare" :size="15" />
        </button>
        <button class="btn-icon !h-7 !w-7" :title="t('tree.newDoc')" @click="newDocDir = ''; newDocOpen = true">
          <AppIcon name="filePlus" :size="15" />
        </button>
        <button class="btn-icon !h-7 !w-7" :title="t('tree.newFolder')" @click="prompt = { mode: 'newFolder', parent: '' }">
          <AppIcon name="folderPlus" :size="15" />
        </button>
        <button class="btn-icon !h-7 !w-7" :title="t('tree.importFiles')" @click="onImport('')">
          <AppIcon name="download" :size="15" />
        </button>
      </div>
    </div>

    <!-- 固定首页入口(不随树滚动,缺失时点击创建) -->
    <div class="px-2 pb-1 pt-2">
      <div
        class="home-row flex h-[30px] cursor-default items-center gap-1 rounded-md px-1 select-none"
        :class="{ active: homeActive, 'is-missing': !homeNode }"
        :title="homeNode ? 'index.md' : t('tree.homeCreateHint')"
        @click="openHomepage"
      >
        <span class="w-5 shrink-0" />
        <AppIcon name="home" :size="15" class="home-row-icon shrink-0" :class="homeActive ? 'text-ink-2' : 'text-ink-3'" />
        <span class="min-w-0 flex-1 truncate text-[calc(13px*var(--ui-font-scale))]" :class="homeActive ? 'font-medium' : ''">
          {{ t("tree.home") }}
        </span>
        <span v-if="!homeNode" class="shrink-0 pr-1 text-[calc(10.5px*var(--ui-font-scale))] text-ink-3">
          {{ t("tree.homeMissing") }}
        </span>
      </div>
    </div>

    <div
      ref="scrollEl"
      class="relative min-h-0 flex-1 overflow-y-auto px-2 pb-4"
      :class="{ 'select-none': selectMode }"
      @dragover="onTreeDragOver"
      @dragleave="onTreeDragLeave"
      @drop="onTreeDrop"
      @pointerdown="onBandDown"
      @pointermove="onBandMove"
      @pointerup="onBandUp"
      @pointercancel="onBandCancel"
    >
      <!-- 框选矩形 -->
      <div
        v-if="band"
        class="band"
        :style="{ left: band.x + 'px', top: band.y + 'px', width: band.w + 'px', height: band.h + 'px' }"
      />
      <p v-if="!displayTree.length && !site.treeLoading" class="px-2 py-8 text-center text-[calc(12.5px*var(--ui-font-scale))] leading-relaxed text-ink-3">
        {{ t("tree.empty") }}
      </p>
      <template v-else>
        <FileTreeNode
          v-for="node in displayTree"
          :key="node.path"
          :node="node"
          :depth="0"
          :selected-paths="selectedPaths"
          :select-mode="selectMode"
          @new-doc-in="(dir: string) => ((newDocDir = dir), (newDocOpen = true))"
          @rename="(n: TreeNode) => (prompt = { mode: 'rename', node: n })"
          @remove="onRemove"
          @move="onMove"
          @reorder="onReorder"
          @select-click="handleSelectClick"
          @import-to="(dir: string) => onImport(dir)"
        />
        <!-- 拖到空白处:移动到根目录末尾的指示线 -->
        <div v-if="dropMark?.kind === 'root-end'" class="drop-line-root" aria-hidden="true" />
      </template>
    </div>

    <!-- 顶缘分隔线:上下拖动调整资产栏高度(伪元素扩展命中区,视觉仍为 1px) -->
    <div
      class="relative h-px shrink-0 cursor-row-resize bg-line after:absolute after:inset-x-0 after:-bottom-1 after:-top-1 after:content-['']"
      @pointerdown="onAssetDividerDown"
      @pointermove="onAssetDividerMove"
    />

    <!-- 底部资产栏:站点图片资源区,支持卡片/列表视图,按住图片拖入正文即插入引用 -->
    <div class="flex shrink-0 flex-col" :style="{ height: assetH + 'px' }">
      <div class="flex items-center justify-between px-3 pb-1 pt-2">
        <span class="text-[calc(12px*var(--ui-font-scale))] font-semibold tracking-wide text-ink-3">
          {{ t("tree.assets") }} · {{ site.assetFiles.length }}
        </span>
        <div class="flex items-center gap-0.5">
          <!-- 单按钮切换:图标显示将要切换到的视图 -->
          <button
            class="btn-icon !h-6 !w-6"
            :title="assetView === 'card' ? t('tree.assetListView') : t('tree.assetCardView')"
            @click="assetView = assetView === 'card' ? 'list' : 'card'"
          >
            <AppIcon :name="assetView === 'card' ? 'listBullet' : 'grid'" :size="13" />
          </button>
          <button class="btn-icon !h-6 !w-6" :title="t('tree.importImages')" @click="importImages">
            <AppIcon name="download" :size="13" />
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <p v-if="!site.assetFiles.length" class="px-2 py-5 text-center text-[calc(12px*var(--ui-font-scale))] leading-relaxed text-ink-3">
          {{ t("tree.assetEmpty") }}
        </p>
        <div v-else-if="assetView === 'card'" class="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-1.5">
          <div
            v-for="img in site.assetFiles"
            :key="img.path"
            class="asset-chip"
            :title="t('tree.assetDragHint', { name: img.name })"
            draggable="true"
            @dragstart="onAssetDragStart($event, img)"
          >
            <img
              v-if="assetThumb(img.path) && !brokenThumbs.has(img.path)"
              :src="assetThumb(img.path)"
              :alt="img.name"
              loading="lazy"
              draggable="false"
              @error="brokenThumbs.add(img.path)"
            />
            <span v-else class="asset-chip-fallback">{{ img.name }}</span>
            <span class="asset-chip-name">{{ img.name }}</span>
          </div>
        </div>
        <div v-else class="flex flex-col">
          <div
            v-for="img in site.assetFiles"
            :key="img.path"
            class="asset-row"
            :title="t('tree.assetDragHint', { name: img.name })"
            draggable="true"
            @dragstart="onAssetDragStart($event, img)"
          >
            <AppIcon name="image" :size="14" class="shrink-0 text-ink-3" />
            <span class="min-w-0 flex-1 truncate text-[calc(12.5px*var(--ui-font-scale))]">{{ img.name }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部多选状态条:计数与批量操作固定在侧栏底部,不随树滚动 -->
    <div
      v-if="selectedCount > 0"
      class="flex shrink-0 items-center gap-2 border-t border-line bg-surface-2 px-3 py-2"
    >
      <span class="shrink-0 whitespace-nowrap text-[calc(12px*var(--ui-font-scale))] font-medium text-ink-2">{{ t("tree.selected", { n: selectedCount }) }}</span>
      <div class="ml-auto flex items-center gap-1">
        <button class="btn btn-sm btn-secondary text-[calc(11.5px*var(--ui-font-scale))]" @click="showMoveDialog = true">
          <AppIcon name="folder" :size="13" />
          {{ t("tree.moveTo") }}
        </button>
        <button class="btn-icon !h-6 !w-6" :title="t('tree.deselect')" @click="clearSelection">
          <AppIcon name="x" :size="13" />
        </button>
      </div>
    </div>

    <PromptModal
      :open="prompt !== null"
      :title="promptTitle()"
      :label="promptLabel()"
      :placeholder="t('tree.namePlaceholder')"
      :initial="promptInitial()"
      :confirm-text="prompt?.mode === 'newFolder' ? t('common.create') : t('common.confirm')"
      @confirm="onPromptConfirm"
      @cancel="prompt = null"
    />

    <!-- 新建文档:名称与配置头(标题/描述/日期/封面)一次填好 -->
    <NewDocModal :open="newDocOpen" :dir="newDocDir" @confirm="onNewDocConfirm" @cancel="newDocOpen = false" />

    <!-- 配置头可视化编辑(文件树右键入口) -->
    <FrontMatterModal
      :open="fmOpen"
      :doc-path="fmTarget"
      :initial="fmInitial"
      :blog-home="fmBlogHome"
      @confirm="onFmConfirm"
      @cancel="fmOpen = false"
    />

    <!-- 移动目标文件夹选择对话框 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showMoveDialog" class="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div class="absolute inset-0 bg-[var(--color-scrim)]" @click="showMoveDialog = false" />
          <div class="modal-card panel relative w-full max-w-[360px] shadow-window">
            <header class="px-6 pb-2 pt-5">
              <h2 class="text-[calc(16px*var(--ui-font-scale))] font-semibold">{{ t("tree.moveToFolder") }}</h2>
            </header>
            <div class="max-h-[300px] overflow-y-auto px-6 pb-2">
              <button
                class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[calc(13.5px*var(--ui-font-scale))] hover:bg-surface-2"
                @click="batchMoveTo('')"
              >
                <AppIcon name="folder" :size="15" class="text-ink-3" />
                {{ t("tree.moveToRoot") }}
              </button>
              <button
                v-for="dir in collectDirs()"
                :key="dir.path"
                class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[calc(13.5px*var(--ui-font-scale))] hover:bg-surface-2"
                :disabled="selectedPaths.has(dir.path)"
                @click="batchMoveTo(dir.path)"
              >
                <AppIcon name="folder" :size="15" class="text-ink-3" />
                <span class="truncate">{{ dir.path }}</span>
              </button>
              <p v-if="collectDirs().length === 0" class="py-4 text-center text-[calc(12.5px*var(--ui-font-scale))] text-ink-3">
                {{ t("tree.empty") }}
              </p>
            </div>
            <footer class="flex justify-end gap-2 border-t border-line px-6 py-4">
              <button class="btn btn-secondary" @click="showMoveDialog = false">{{ t("common.cancel") }}</button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* 固定首页入口:与树行同规格,缺失时整行弱化 */
.home-row {
  transition: background-color var(--duration-base) var(--ease-plain);
}
.home-row:hover {
  background: var(--color-surface-2);
}
.home-row.active {
  background: var(--color-surface-3);
}
.home-row.is-missing .home-row-icon {
  color: var(--color-ink-3);
  opacity: 0.75;
}

/* 多选模式按钮激活态:实心墨底 */
.select-btn[aria-pressed="true"] {
  background: var(--color-accent);
  color: var(--color-on-accent);
}
.select-btn[aria-pressed="true"]:hover {
  background: var(--color-accent-strong);
}

/* 框选矩形 */
.band {
  position: absolute;
  z-index: 10;
  pointer-events: none;
  border: 1px solid color-mix(in srgb, var(--color-ink) 40%, transparent);
  background: color-mix(in srgb, var(--color-ink) 6%, transparent);
  border-radius: 3px;
}

/* 资产栏卡片:缩略图 + 文件名,按住可拖入正文 */
.asset-chip {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  cursor: grab;
  transition:
    border-color var(--duration-base) var(--ease-plain),
    background-color var(--duration-base) var(--ease-plain);
}
.asset-chip:hover {
  background: var(--color-surface-2);
}
.asset-chip:active {
  cursor: grabbing;
}
.asset-chip img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  background: repeating-conic-gradient(var(--color-surface-2) 0 25%, transparent 0 50%) 0 0 / 12px 12px;
}
.asset-chip-fallback {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 4px;
  overflow: hidden;
  color: var(--color-ink-3);
  font-size: calc(10px * var(--ui-font-scale));
  text-align: center;
}
.asset-chip-name {
  overflow: hidden;
  padding: 2px 5px 3px;
  color: var(--color-ink-3);
  font-size: calc(10px * var(--ui-font-scale));
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 资产栏列表视图 */
.asset-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 6px;
  color: var(--color-ink-2);
  cursor: grab;
  transition: background-color var(--duration-base) var(--ease-plain);
}
.asset-row:hover {
  background: var(--color-surface-2);
}
.asset-row:active {
  cursor: grabbing;
}

/* 拖到空白处:根目录末尾的插入线 */
.drop-line-root {
  height: 2px;
  margin: 3px 4px 0;
  border-radius: 1px;
  background: var(--color-accent);
  pointer-events: none;
}
</style>
