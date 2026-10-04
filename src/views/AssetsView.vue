<script setup lang="ts">
/** 资产页 -- 管理站点 asset 文件夹(兼容旧 images)中的图片:预览、多选(框选/修饰键)、
 *  拖放到文件夹、重命名(联动更新引用)、删除、查找引用 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { collectDocPaths } from "@/lib/builder";
import { formatSize } from "@/lib/format";
import { moveImageRefs, countImageRefs, findImageRefs, replaceImageRefs, type ImageRef } from "@/lib/imageRefs";
import { basename, dirname, ASSET_MIME } from "@/lib/paths";
import { siteUrl } from "@/lib/preview";
import { toCssPx } from "@/lib/scale";
import { ipc } from "@/ipc/ipc";
import type { TreeNode } from "@/ipc/types";
import { useAppStore } from "@/stores/app";
import { useEditorStore } from "@/stores/editor";
import { useSiteStore } from "@/stores/site";
import { useUiStore } from "@/stores/ui";
import AppIcon from "@/components/AppIcon.vue";
import PromptModal from "@/components/PromptModal.vue";
import SelectMenu from "@/components/SelectMenu.vue";

const { t } = useI18n();
const app = useAppStore();
const site = useSiteStore();
const editor = useEditorStore();
const ui = useUiStore();

/** 站点资产(asset,兼容旧 images)下的全部图片文件(含子文件夹,与分组同源) */
const images = computed<TreeNode[]>(() => site.assetGroups.flatMap((g) => g.images));

/* ---------- 双视图:卡片(分组)/ 列表(分组) ---------- */

const viewMode = ref<"card" | "list">("card");

/** 按视图顺序排列的图片路径(Shift 范围选择与框选都按这个顺序) */
const orderedPaths = computed(() => images.value.map((n) => n.path));

/** 新建文件夹:建在主资产目录(asset,兼容旧 images)根层;
 *  建完刷新树,空文件夹也会作为分组出现(可直接往里拖图) */
async function newFolder() {
  const base = site.assetDirs[0]?.path;
  if (!base) return;
  const name = await askName("", {
    title: t("assets.newFolderTitle"),
    label: t("assets.folderNameLabel"),
    confirmText: t("common.confirm"),
  });
  if (!name) return;
  try {
    await ipc.createFolder(base, name);
    await site.refreshTree();
    ui.toast(t("assets.folderCreated", { name }), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

/* ---------- 选择:单选 / Ctrl(⌘)加选 / Shift 范围 / 空白处框选 ---------- */

const selected = ref<string[]>([]);
const selectionSet = computed(() => new Set(selected.value));
/** 每次点击后记录的锚点,供 Shift 范围选择 */
const anchorPath = ref<string | null>(null);

const onlyOne = computed(() => (selected.value.length === 1 ? selected.value[0] : null));
/** 多选汇总:文件数以外的信息用于右栏摘要 */
const selectedNodes = computed(() => images.value.filter((n) => selectionSet.value.has(n.path)));
const selectedSize = computed(() =>
  selectedNodes.value.reduce((sum, n) => sum + (n.size ?? 0), 0),
);

function onItemClick(path: string, e: MouseEvent) {
  if (e.shiftKey && anchorPath.value) {
    const list = orderedPaths.value;
    const a = list.indexOf(anchorPath.value);
    const b = list.indexOf(path);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      selected.value = list.slice(lo, hi + 1);
      return;
    }
  }
  if (e.metaKey || e.ctrlKey) {
    selected.value = selectionSet.value.has(path)
      ? selected.value.filter((p) => p !== path)
      : [...selected.value, path];
  } else {
    selected.value = [path];
  }
  anchorPath.value = path;
}

/* ---------- 框选:在空白处按住拖动,划定区域内的图片一并选中 ---------- */

const listHost = ref<HTMLElement>();
const marquee = ref<{ x: number; y: number; w: number; h: number } | null>(null);
let marqueeStart: { x: number; y: number } | null = null;
/** 框选起始时的已有选择:按住修饰键框选是追加而非替换 */
let marqueeBase: string[] = [];

/** 指针位置换算为容器内容坐标(减外框、加滚动偏移) */
function hostPoint(e: PointerEvent): { x: number; y: number } {
  const host = listHost.value!;
  const rect = host.getBoundingClientRect();
  return {
    x: e.clientX - rect.left + host.scrollLeft,
    y: e.clientY - rect.top + host.scrollTop,
  };
}

function onHostPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  const el = e.target as HTMLElement;
  // 从卡片上按下交给点击/拖拽;按钮等控件同样不启动框选
  if (el.closest("[data-asset-item]") || el.closest("button,input")) return;
  const host = listHost.value;
  if (!host) return;
  const p = hostPoint(e);
  marqueeStart = p;
  marqueeBase = e.shiftKey || e.metaKey || e.ctrlKey ? [...selected.value] : [];
  if (!marqueeBase.length) selected.value = [];
  marquee.value = { x: p.x, y: p.y, w: 0, h: 0 };
  host.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onHostPointerMove(e: PointerEvent) {
  const host = listHost.value;
  if (!marqueeStart || !host) return;
  const p = hostPoint(e);
  const box = {
    x: Math.min(marqueeStart.x, p.x),
    y: Math.min(marqueeStart.y, p.y),
    w: Math.abs(p.x - marqueeStart.x),
    h: Math.abs(p.y - marqueeStart.y),
  };
  marquee.value = box;
  const rect = host.getBoundingClientRect();
  const hit = new Set(marqueeBase);
  host.querySelectorAll<HTMLElement>("[data-asset-item]").forEach((el) => {
    const path = el.dataset.assetPath;
    if (!path) return;
    const r = el.getBoundingClientRect();
    const left = r.left - rect.left + host.scrollLeft;
    const top = r.top - rect.top + host.scrollTop;
    const right = r.right - rect.left + host.scrollLeft;
    const bottom = r.bottom - rect.top + host.scrollTop;
    if (left < box.x + box.w && right > box.x && top < box.y + box.h && bottom > box.y) hit.add(path);
  });
  selected.value = [...hit];
  e.preventDefault();
}

function onHostPointerUp(e: PointerEvent) {
  if (!marqueeStart) return;
  marqueeStart = null;
  marquee.value = null;
  listHost.value?.releasePointerCapture(e.pointerId);
}

/* ---------- 拖放到文件夹(引用自动重定向) ---------- */

const dragPaths = ref<string[]>([]);
const dropTarget = ref<string | null>(null);

function onItemDragStart(path: string, e: DragEvent) {
  // 拖动未选中的项时先把选择收敛到它,避免"看着拖 A 实际拖走一片"
  if (!selectionSet.value.has(path)) selected.value = [path];
  dragPaths.value = [...selected.value];
  anchorPath.value = path;
  if (e.dataTransfer) {
    // copyMove:文件夹之间是移动,拖入编辑器是复制;单张图片额外携带
    // ASSET_MIME,编辑器据此插入规范的 markdown 引用(多选拖入不支持)
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("text/plain", dragPaths.value.join("\n"));
    if (dragPaths.value.length === 1) e.dataTransfer.setData(ASSET_MIME, dragPaths.value[0]);
  }
}

function onItemDragEnd() {
  dragPaths.value = [];
  dropTarget.value = null;
}

function onGroupDragOver(dir: string, e: DragEvent) {
  if (!dragPaths.value.length) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  dropTarget.value = dir;
}

function onGroupDragLeave(dir: string, e: DragEvent) {
  // 子元素之间移动时不熄灭指示,避免闪烁
  const related = e.relatedTarget as Node | null;
  const host = e.currentTarget as HTMLElement | null;
  if (related && host?.contains(related)) return;
  if (dropTarget.value === dir) dropTarget.value = null;
}

function onGroupDrop(dir: string, e: DragEvent) {
  e.preventDefault();
  const paths = dragPaths.value;
  dragPaths.value = [];
  dropTarget.value = null;
  if (paths.length) void movePaths(paths, dir);
}

/** 拖放与弹窗共用的移动到…入口 */
const moveOpen = ref(false);
const movePathsOpen = ref<string[]>([]);
const moveTarget = ref("");
const moving = ref(false);
const moveTargetOptions = ref<{ value: string; label: string }[]>([]);

function openMove(paths: string[]) {
  const targets = paths.filter(Boolean);
  if (!targets.length) return;
  movePathsOpen.value = targets;
  // 目标:资产根目录与全部子文件夹(含空文件夹);单个文件时排除它当前所在的目录
  const from = new Set(targets.map((p) => dirname(p)));
  const options = site.assetGroups
    .filter((g) => from.size > 1 || !from.has(g.dir))
    .map((g) => ({ value: g.dir, label: g.label || t("assets.folderRootLabel") }));
  if (!options.length) {
    ui.toast(t("assets.moveNoTarget"), "info");
    return;
  }
  moveTargetOptions.value = options;
  moveTarget.value = options[0].value;
  moveOpen.value = true;
}

async function confirmMove() {
  if (moving.value) return;
  moveOpen.value = false;
  await movePaths(movePathsOpen.value, moveTarget.value);
}

/** 把一批图片移动到目标目录,并同步更新文档中的引用写法 */
async function movePaths(paths: string[], dest: string) {
  const targets = paths.filter((p) => dirname(p) !== dest);
  if (!targets.length) return;
  const refs = targets.flatMap((p) => findImageRefs(p, Object.keys(docs.value), docs.value));
  const dirtyOpen = refs.some((r) => r.docPath === editor.activePath && editor.dirty);
  if (refs.length) {
    const ok = await ui.confirmDialog({
      title: t("assets.moveRefsTitle", { n: refs.length }),
      body: t("assets.moveRefsBody", { n: refs.length }) + (dirtyOpen ? t("assets.renameSkipOpen") : ""),
      confirmText: t("assets.moveRefsConfirm"),
    });
    if (!ok) return;
  }
  moving.value = true;
  try {
    const moved = await site.moveItems(targets, dest);
    await rewriteRefs(moved);
    await loadDocs();
    selected.value = moved.map((m) => m.to);
    ui.toast(
      moved.length > 1
        ? t("assets.movedCount", { n: moved.length, folder: dest })
        : t("assets.moved", { folder: dest }),
      "success",
    );
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  } finally {
    moving.value = false;
  }
}

/** 移动落盘后,把引用这些图片的文档写法改写到新路径 */
async function rewriteRefs(moved: { from: string; to: string }[]) {
  for (const m of moved) {
    const refs = findImageRefs(m.from, Object.keys(docs.value), docs.value);
    for (const r of refs) {
      const isOpen = r.docPath === editor.activePath;
      if (isOpen && editor.dirty) continue;
      const content = isOpen ? editor.content : docs.value[r.docPath];
      if (content === undefined) continue;
      const updated = moveImageRefs(content, [r], m.to, r.docPath);
      if (updated === content) continue;
      await ipc.saveDoc(r.docPath, updated);
      if (isOpen) {
        editor.externalReplace = true;
        editor.content = updated;
        editor.savedContent = updated;
      } else {
        site.updateDocCache(r.docPath, updated);
      }
      docs.value = { ...docs.value, [r.docPath]: updated };
    }
  }
}

/* ---------- 引用索引:全部文档读取一次,重命名/删除后刷新 ---------- */

const docs = ref<Record<string, string>>({});
const loading = ref(false);
/** 加载失败的图片路径:渲染受控占位,避免 Chromium 失败占位盖满窗口 */
const brokenThumbs = ref(new Set<string>());

async function loadDocs() {
  const paths = collectDocPaths(site.tree);
  if (!paths.length) {
    docs.value = {};
    return;
  }
  loading.value = true;
  try {
    const contents = await ipc.readDocs(paths);
    const map: Record<string, string> = {};
    paths.forEach((p, i) => (map[p] = contents[i] ?? ""));
    docs.value = map;
  } finally {
    loading.value = false;
  }
}

onMounted(loadDocs);

/** 手动刷新:重读文件树(资产分组随树重建)与全部文档内容,
 *  外部改动或个别情况下自动刷新缺失时,这里都能完整恢复 */
async function refreshAll() {
  await site.refreshTree();
  await loadDocs();
}

const refCounts = computed(() =>
  countImageRefs(images.value.map((n) => n.path), Object.keys(docs.value), docs.value),
);

/* ---------- 详情窗宽度可拖拽(右侧面板;拖动中才跟踪,避免误触) ---------- */
const splitHost = ref<HTMLElement>();
const detailW = ref(300);
let detailDragging = false;
/** 详情悬浮面板折叠态:折叠后只剩窄轨与展开把手,选择保留 */
const detailCollapsed = ref(false);
/** 把手的横向位置:展开时骑在面板左缘,折叠后居中在窄轨上 */
const tabRight = computed(() => (detailCollapsed.value ? "23px" : `${detailW.value + 1}px`));

function onDividerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  detailDragging = true;
}

function onDividerMove(e: PointerEvent) {
  if (!detailDragging) return;
  if (!(e.buttons & 1)) {
    detailDragging = false;
    return;
  }
  if (!splitHost.value) return;
  const rect = splitHost.value.getBoundingClientRect();
  // 界面缩放档位下指针与 rect 均为视觉像素,宽度声明值经 toCssPx 还原
  detailW.value = Math.min(520, Math.max(220, toCssPx(rect.right - e.clientX)));
}

function onDividerUp() {
  detailDragging = false;
}

const selectedRefs = computed<ImageRef[]>(() =>
  onlyOne.value ? findImageRefs(onlyOne.value, Object.keys(docs.value), docs.value) : [],
);

const selectedNode = computed(() => images.value.find((i) => i.path === onlyOne.value));
const selectedNodeSize = computed(() => selectedNode.value?.size);

/** 打开引用方文档(从内容树定位节点) */
function openDoc(docPath: string) {
  const find = (nodes: TreeNode[]): TreeNode | null => {
    for (const n of nodes) {
      if (n.path === docPath && n.type === "file") return n;
      const hit = n.children ? find(n.children) : null;
      if (hit) return hit;
    }
    return null;
  };
  const node = find(site.tree);
  if (node) {
    void editor.openDoc(node);
    app.setView("editor");
  }
}

/* ---------- 重命名(联动更新引用) ---------- */

const askOpen = ref(false);
const askValue = ref("");
const askTitle = ref(t("assets.renameTitle"));
const askLabel = ref(t("assets.renameLabel"));
const askConfirmText = ref(t("common.rename"));
let askResolve: ((v: string | null) => void) | null = null;

function askName(
  current: string,
  opts?: { title?: string; label?: string; confirmText?: string },
): Promise<string | null> {
  askValue.value = current;
  askTitle.value = opts?.title ?? t("assets.renameTitle");
  askLabel.value = opts?.label ?? t("assets.renameLabel");
  askConfirmText.value = opts?.confirmText ?? t("common.rename");
  askOpen.value = true;
  return new Promise((resolve) => {
    askResolve = resolve;
  });
}

function onAskConfirm(v: string) {
  askOpen.value = false;
  askResolve?.(v.trim() || null);
  askResolve = null;
}

function onAskCancel() {
  askOpen.value = false;
  askResolve?.(null);
  askResolve = null;
}

async function rename(img: TreeNode) {
  const newName = await askName(basename(img.path));
  if (!newName || newName === img.name) return;
  const refs = findImageRefs(img.path, Object.keys(docs.value), docs.value);
  // 打开中的文档默认一并替换(编辑器内容同步);有未保存修改时跳过,避免覆盖用户输入
  const dirtyOpen = refs.some((r) => r.docPath === editor.activePath && editor.dirty);
  if (refs.length) {
    const ok = await ui.confirmDialog({
      title: t("assets.renameRefsTitle", { n: refs.length }),
      body: t("assets.renameRefsBody", { n: refs.length }) + (dirtyOpen ? t("assets.renameSkipOpen") : ""),
      confirmText: t("assets.renameRefsConfirm"),
    });
    if (!ok) return;
  }
  try {
    const newPath = await site.renameItem(img.path, newName);
    for (const r of refs) {
      const isOpen = r.docPath === editor.activePath;
      if (isOpen && editor.dirty) continue;
      const content = isOpen ? editor.content : docs.value[r.docPath];
      if (content === undefined) continue;
      const updated = replaceImageRefs(content, [r], newName);
      if (updated === content) continue;
      await ipc.saveDoc(r.docPath, updated);
      if (isOpen) {
        // 编辑器离开工作区时已卸载,直接同步 store;若仍在挂载中则让 CM 同步新内容
        editor.externalReplace = true;
        editor.content = updated;
        editor.savedContent = updated;
      } else {
        site.updateDocCache(r.docPath, updated);
      }
      docs.value = { ...docs.value, [r.docPath]: updated };
    }
    if (onlyOne.value === img.path) selected.value = [newPath];
    // 替换全部落盘后重读一次,保证引用计数与磁盘一致(树刷新触发的读取可能早于保存)
    await loadDocs();
    ui.toast(t("assets.renamed", { name: newName }), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

/* ---------- 删除(二级确认,支持多选批量) ---------- */

async function remove(paths: string[]) {
  const targets = paths.filter((p) => p);
  if (!targets.length) return;
  const n = targets.reduce((sum, p) => sum + (refCounts.value.get(p) ?? 0), 0);
  const name = targets.length === 1 ? targets[0] : "";
  const ok = await ui.confirmDialog({
    title: targets.length > 1 ? t("assets.deleteManyTitle", { n: targets.length }) : t("assets.deleteTitle"),
    body:
      targets.length > 1
        ? t("assets.deleteManyBody", { n: targets.length, refs: n })
        : n
          ? t("assets.deleteBodyReferenced", { name: basename(name), n })
          : t("assets.deleteBody", { name: basename(name) }),
    danger: true,
    confirmText: t("common.delete"),
  });
  if (!ok) return;
  try {
    await site.deleteItems(targets);
    selected.value = [];
    ui.toast(
      targets.length > 1
        ? t("assets.deletedCount", { n: targets.length })
        : t("assets.deleted", { name: basename(name) }),
      "success",
    );
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

function thumbUrl(path: string): string {
  // 浏览器 mock 无 site:// 资源服务:返回空让 <img> 以 alt(文件名)占位
  return app.platform === "browser" ? "" : siteUrl(app.platform, `content/${path}`);
}

/* ---------- 文件夹移出至回收站(二级确认,联动统计引用) ---------- */

async function removeFolder(g: { dir: string; label: string; images: TreeNode[] }) {
  // 根资产目录(asset)是站点结构的一部分,不提供移出
  if (!g.label) return;
  const refs = g.images.reduce((sum, img) => sum + (refCounts.value.get(img.path) ?? 0), 0);
  const ok = await ui.confirmDialog({
    title: t("assets.folderTrashTitle", { name: g.label }),
    body: refs
      ? t("assets.folderTrashBodyRefs", { name: g.label, files: g.images.length, refs })
      : t("assets.folderTrashBody", { name: g.label, files: g.images.length }),
    danger: true,
    confirmText: t("assets.folderTrashConfirm"),
  });
  if (!ok) return;
  try {
    await site.deleteItems([g.dir]);
    // 选中的文件可能随文件夹一并移出,清理残留选择
    selected.value = selected.value.filter((p) => !p.startsWith(`${g.dir}/`));
    ui.toast(t("assets.folderTrashed", { name: g.label }), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-bg">
    <!-- 头部 -->
    <header class="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
      <div class="min-w-0">
        <h1 class="text-[calc(15px*var(--ui-font-scale))] font-semibold leading-tight">{{ t("assets.title") }}</h1>
        <p class="truncate text-[calc(12px*var(--ui-font-scale))] text-ink-3">{{ t("assets.subtitle") }}</p>
      </div>
      <!-- 顶栏右侧:视图切换 / 新建文件夹 / 刷新 -->
      <div class="ml-auto flex items-center gap-1">
        <button
          class="btn-icon !h-8 !w-8"
          :title="viewMode === 'card' ? t('tree.assetListView') : t('tree.assetCardView')"
          @click="viewMode = viewMode === 'card' ? 'list' : 'card'"
        >
          <AppIcon :name="viewMode === 'card' ? 'listBullet' : 'grid'" :size="15" />
        </button>
        <button class="btn-icon !h-8 !w-8" :title="t('assets.newFolder')" @click="newFolder">
          <AppIcon name="folderPlus" :size="15" />
        </button>
        <button class="btn-icon !h-8 !w-8" :title="t('common.refresh')" @click="refreshAll">
          <AppIcon name="refresh" :size="15" />
        </button>
      </div>
    </header>

    <!-- 左:图片网格 | 右:详情窗(宽度可拖拽) -->
    <div ref="splitHost" class="relative flex min-h-0 flex-1">
    <div
      ref="listHost"
      class="relative min-w-0 flex-1 overflow-y-auto p-5"
      @pointerdown="onHostPointerDown"
      @pointermove="onHostPointerMove"
      @pointerup="onHostPointerUp"
      @pointercancel="onHostPointerUp"
    >
      <!-- 工具行:仅剩计数(视图切换与新建文件夹已移到页头顶栏) -->
      <div class="flex items-center">
        <span class="field-label">
          {{ t("tree.assets") }} · {{ images.length }}
          <span v-if="selected.length" class="ml-2 text-ink-3">{{ t("assets.selectedCount", { n: selected.length }) }}</span>
        </span>
      </div>

      <p v-if="!images.length && site.assetGroups.length <= 1" class="mt-3 rounded-lg border border-dashed border-line px-4 py-10 text-center text-[calc(13px*var(--ui-font-scale))] leading-relaxed text-ink-3">
        {{ t("assets.empty") }}
      </p>

      <template v-else>
        <p class="mt-2 text-[calc(11.5px*var(--ui-font-scale))] text-ink-3">{{ t("assets.selectHint") }}</p>

        <!-- 按文件夹分组:组标题即投放目标(拖图到标题上移动),空文件夹同样列出 -->
        <template v-for="g in site.assetGroups" :key="g.dir">
          <div
            class="asset-group group"
            :class="{ 'is-drop': dropTarget === g.dir, 'is-empty': !g.images.length }"
            @dragover="onGroupDragOver(g.dir, $event)"
            @dragleave="onGroupDragLeave(g.dir, $event)"
            @drop="onGroupDrop(g.dir, $event)"
          >
            <AppIcon name="folder" :size="13" class="shrink-0" />
            <span class="truncate">{{ g.label || t("assets.folderRootLabel") }}</span>
            <span class="mono shrink-0 text-ink-3">{{ g.images.length }}</span>
            <!-- 子文件夹可移出至回收站(根资产目录除外);悬停时出现,避免误触 -->
            <button
              v-if="g.label"
              class="btn-icon !h-6 !w-6 shrink-0 opacity-0 transition-opacity hover:!text-danger group-hover:opacity-100"
              :title="t('assets.folderTrash')"
              @click.stop="removeFolder(g)"
            >
              <AppIcon name="trash" :size="12" />
            </button>
          </div>

          <p v-if="!g.images.length" class="asset-group-empty">{{ t("assets.emptyFolder") }}</p>

          <!-- 列表视图:缩略图 + 路径 + 大小 + 引用数 -->
          <div v-else-if="viewMode === 'list'" class="flex flex-col gap-1.5">
            <div
              v-for="img in g.images"
              :key="img.path"
              class="asset-row"
              :class="{ selected: selectionSet.has(img.path), dragging: dragPaths.includes(img.path) }"
              data-asset-item
              :data-asset-path="img.path"
              draggable="true"
              @click="onItemClick(img.path, $event)"
              @dragstart="onItemDragStart(img.path, $event)"
              @dragend="onItemDragEnd"
            >
              <span class="row-thumb">
                <img
                  v-if="thumbUrl(img.path) && !brokenThumbs.has(img.path)"
                  :src="thumbUrl(img.path)"
                  :alt="img.name"
                  loading="lazy"
                  @error="brokenThumbs.add(img.path)"
                />
                <span v-else class="thumb-fallback">{{ img.name }}</span>
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[calc(12.5px*var(--ui-font-scale))] text-ink">{{ img.name }}</span>
                <span class="mono block truncate text-[calc(10.5px*var(--ui-font-scale))] text-ink-3">{{ img.path }}</span>
              </span>
              <span class="mono shrink-0 text-[calc(11px*var(--ui-font-scale))] text-ink-3">
                {{ img.size ? formatSize(img.size) : "" }}
              </span>
              <span class="ref-count shrink-0" :class="{ zero: !(refCounts.get(img.path) ?? 0) }">
                {{ t("assets.refCount", { n: refCounts.get(img.path) ?? 0 }) }}
              </span>
              <span class="actions flex shrink-0 items-center gap-0.5">
                <button class="btn-icon !h-6 !w-6" :title="t('assets.rename')" @click.stop="rename(img)">
                  <AppIcon name="pencil" :size="13" />
                </button>
                <button class="btn-icon !h-6 !w-6 hover:!text-danger" :title="t('common.delete')" @click.stop="remove([img.path])">
                  <AppIcon name="trash" :size="13" />
                </button>
              </span>
            </div>
          </div>

          <!-- 卡片视图 -->
          <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
            <div
              v-for="img in g.images"
              :key="img.path"
              class="asset-card"
              :class="{ selected: selectionSet.has(img.path), dragging: dragPaths.includes(img.path) }"
              data-asset-item
              :data-asset-path="img.path"
              draggable="true"
              @click="onItemClick(img.path, $event)"
              @dragstart="onItemDragStart(img.path, $event)"
              @dragend="onItemDragEnd"
            >
              <div class="thumb">
                <img
                  v-if="thumbUrl(img.path) && !brokenThumbs.has(img.path)"
                  :src="thumbUrl(img.path)"
                  :alt="img.name"
                  loading="lazy"
                  @error="brokenThumbs.add(img.path)"
                />
                <span v-else class="thumb-fallback">{{ img.name }}</span>
              </div>
              <p
                class="truncate px-2 pt-1.5 text-[calc(12px*var(--ui-font-scale))]"
                :title="img.size != null ? `${img.name} · ${formatSize(img.size)}` : img.name"
              >
                {{ img.name }}
              </p>
              <div class="px-2 pb-2 pt-0.5">
                <div class="flex items-center justify-between">
                  <span class="ref-count" :class="{ zero: !(refCounts.get(img.path) ?? 0) }">
                    {{ t("assets.refCount", { n: refCounts.get(img.path) ?? 0 }) }}
                  </span>
                  <div class="actions flex items-center gap-0.5">
                    <button class="btn-icon !h-6 !w-6" :title="t('assets.rename')" @click.stop="rename(img)">
                      <AppIcon name="pencil" :size="13" />
                    </button>
                    <button class="btn-icon !h-6 !w-6 hover:!text-danger" :title="t('common.delete')" @click.stop="remove([img.path])">
                      <AppIcon name="trash" :size="13" />
                    </button>
                  </div>
                </div>
                <!-- 文件大小:默认显示在引用计数下一行 -->
                <p v-if="img.size" class="mono pt-0.5 text-[calc(11px*var(--ui-font-scale))] text-ink-3">
                  {{ formatSize(img.size) }}
                </p>
              </div>
            </div>
          </div>
        </template>
      </template>

      <!-- 框选矩形:跟随指针划定区域 -->
      <div
        v-if="marquee"
        class="marquee"
        :style="{ left: `${marquee.x}px`, top: `${marquee.y}px`, width: `${marquee.w}px`, height: `${marquee.h}px` }"
        aria-hidden="true"
      />
    </div>

    <!-- 右:详情/批量操作面板:悬浮于列表之上,滑入/滑出只动 transform,
         列表与网格的布局宽度永不变化 —— 选中零位移 -->
    <Transition name="detail-slide">
      <aside
        v-if="selected.length"
        class="detail-panel"
        :class="{ collapsed: detailCollapsed }"
        :style="{ width: (detailCollapsed ? 44 : detailW) + 'px' }"
      >
        <div
          class="detail-handle"
          @pointerdown="onDividerDown"
          @pointermove="onDividerMove"
          @pointerup="onDividerUp"
          @pointercancel="onDividerUp"
          @lostpointercapture="onDividerUp"
        />

        <!-- 折叠/展开把手:骑在面板左缘,折叠后横移到窄轨中央成为唯一控件 -->
        <button
          class="detail-tab"
          :style="{ right: tabRight }"
          :title="detailCollapsed ? t('assets.expandPanel') : t('assets.collapsePanel')"
          :aria-expanded="!detailCollapsed"
          @click="detailCollapsed = !detailCollapsed"
        >
          <AppIcon :name="detailCollapsed ? 'chevronLeft' : 'chevronRight'" :size="14" />
        </button>

        <!-- 圆角裁剪层:折叠时内容淡出,宽度过渡期间内容被面板边缘裁掉 -->
        <div class="detail-clip">
          <div class="detail-contents" :class="{ hidden: detailCollapsed }">

        <!-- 多选:摘要 + 批量动作 -->
        <div v-if="selected.length > 1" class="detail-body">
        <div class="flex items-center gap-1">
          <span class="min-w-0 flex-1 truncate text-[calc(13.5px*var(--ui-font-scale))] font-semibold">
            {{ t("assets.selectedCount", { n: selected.length }) }}
          </span>
          <button class="btn-icon !h-7 !w-7" :title="t('assets.clearSelection')" @click="selected = []">
            <AppIcon name="x" :size="14" />
          </button>
        </div>
        <p v-if="selectedSize" class="mono mt-1 text-[calc(11px*var(--ui-font-scale))] text-ink-3">
          {{ t("assets.totalSize", { size: formatSize(selectedSize) }) }}
        </p>
        <div class="mt-3 flex flex-col gap-2">
          <button class="btn btn-secondary justify-start" @click="openMove(selected)">
            <AppIcon name="folderMove" :size="14" />
            {{ t("assets.moveSelected") }}
          </button>
          <button class="btn btn-secondary justify-start hover:!text-danger" @click="remove(selected)">
            <AppIcon name="trash" :size="14" />
            {{ t("assets.deleteSelected") }}
          </button>
        </div>
        <h3 class="field-label mt-4">{{ t("assets.selectedListHeading") }}</h3>
        <ul class="mt-1 flex flex-col">
          <li
            v-for="n in selectedNodes"
            :key="n.path"
            class="mono truncate py-0.5 text-[calc(11px*var(--ui-font-scale))] text-ink-2"
            :title="n.path"
          >
            {{ n.path }}
          </li>
        </ul>
        </div>

      <!-- 单选:预览 + 引用位置 -->
      <div v-else-if="selectedNode" class="detail-body">
        <div class="flex items-center gap-1">
          <span class="min-w-0 flex-1 truncate text-[calc(13.5px*var(--ui-font-scale))] font-semibold" :title="selectedNode.path">{{ selectedNode.name }}</span>
          <button class="btn-icon !h-7 !w-7" :title="t('assets.rename')" @click="rename(selectedNode)">
            <AppIcon name="pencil" :size="14" />
          </button>
          <button class="btn-icon !h-7 !w-7" :title="t('assets.moveTo')" @click="openMove([selectedNode.path])">
            <AppIcon name="folderMove" :size="14" />
          </button>
          <button class="btn-icon !h-7 !w-7 hover:!text-danger" :title="t('common.delete')" @click="remove([selectedNode.path])">
            <AppIcon name="trash" :size="14" />
          </button>
          <button class="btn-icon !h-7 !w-7" :title="t('common.close')" @click="selected = []">
            <AppIcon name="x" :size="14" />
          </button>
        </div>

        <div class="detail-preview mt-3">
          <img
            v-if="thumbUrl(selectedNode.path) && !brokenThumbs.has(selectedNode.path)"
            :key="selectedNode.path"
            :src="thumbUrl(selectedNode.path)"
            :alt="selectedNode.name"
            @error="brokenThumbs.add(selectedNode.path)"
          />
          <span v-else class="thumb-fallback h-full w-full">{{ selectedNode.name }}</span>
        </div>
        <p class="mono mt-2 break-all text-[calc(11px*var(--ui-font-scale))] text-ink-3">{{ selectedNode.path }}</p>
        <!-- 详细大小:人类可读 + 精确字节 -->
        <p v-if="selectedNodeSize != null" class="mono mt-1 text-[calc(11px*var(--ui-font-scale))] text-ink-3">
          {{ formatSize(selectedNodeSize) }} · {{ selectedNodeSize.toLocaleString("en-US") }} B
        </p>

        <h3 class="field-label mt-4">{{ t("assets.refsHeading") }}</h3>
        <ul v-if="selectedRefs.length" class="mt-1 flex flex-col">
          <li v-for="(r, i) in selectedRefs" :key="i">
            <button class="ref-row" :title="t('assets.openReferrer')" @click="openDoc(r.docPath)">
              <AppIcon name="doc" :size="13" />
              <span class="min-w-0 flex-1 truncate text-left">{{ r.docPath }}</span>
              <AppIcon name="arrowRight" :size="12" class="shrink-0 text-ink-3" />
            </button>
          </li>
        </ul>
        <p v-else class="mt-1 text-[calc(12px*var(--ui-font-scale))] text-ink-3">{{ t("assets.noRefs") }}</p>
        </div>
        </div>
        </div>
      </aside>
    </Transition>

    </div>

    <!-- 移动到文件夹(引用自动重定向) -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="moveOpen" class="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div class="absolute inset-0 bg-[var(--color-scrim)]" @click="moveOpen = false" />
          <div class="modal-card panel relative w-full max-w-[400px] shadow-window">
            <header class="px-6 pb-2 pt-5">
              <h2 class="text-[calc(16px*var(--ui-font-scale))] font-semibold">
                {{ movePathsOpen.length > 1
                  ? t("assets.moveManyTitle", { n: movePathsOpen.length })
                  : t("assets.moveTitle", { name: movePathsOpen[0] ? basename(movePathsOpen[0]) : "" }) }}
              </h2>
            </header>
            <div class="px-6 pb-2">
              <label class="field-label">{{ t("assets.moveTarget") }}</label>
              <SelectMenu v-model="moveTarget" :options="moveTargetOptions" align="left" />
            </div>
            <footer class="mt-2 flex justify-end gap-2 border-t border-line px-6 py-4">
              <button class="btn btn-secondary" @click="moveOpen = false">{{ t("common.cancel") }}</button>
              <button class="btn btn-primary" :disabled="moving" @click="confirmMove">
                {{ moving ? t("common.loading") : t("assets.moveRefsConfirm") }}
              </button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 重命名 / 新建文件夹(共用输入弹窗) -->
    <PromptModal
      :open="askOpen"
      :title="askTitle"
      :label="askLabel"
      :initial="askValue"
      :confirm-text="askConfirmText"
      @confirm="onAskConfirm"
      @cancel="onAskCancel"
    />
  </div>
</template>

<style scoped>
/* 详情面板:悬浮圆角面板 —— 上/右/下离边缘留白,不与内容区拼接;
   滑入/滑出只动 transform,折叠/展开过渡宽度(面板脱离文档流,仅自身重绘);
   拖拽把手调宽只影响面板自身,列表与网格布局不变 */
.detail-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-xl, 10px);
  background: var(--color-surface);
  box-shadow: var(--shadow-popover);
  transition: width 260ms var(--ease-plain); /* deslop-ignore 26: 折叠/展开过渡的就是宽度本身,面板脱离文档流仅自身重绘 */
}
/* 圆角裁剪层:面板本体不裁剪(折叠把手要探出左缘),由它负责圆角内的滚动裁剪 */
.detail-clip {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: inherit;
}
.detail-contents {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  transition:
    opacity var(--duration-base) var(--ease-plain),
    visibility var(--duration-base) linear;
}
.detail-contents.hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
/* 折叠/展开把手:骑在面板左缘的小竖把手;折叠后横移到窄轨中央。
   元素脱离文档流且仅自身重绘,位移用 right 过渡即可 */
.detail-tab {
  position: absolute;
  top: 50%;
  right: 321px; /* 实际值由行内样式给出 */
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 40px;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-ink-3);
  cursor: pointer;
  transform: translateY(-50%);
  box-shadow: var(--shadow-popover);
  transition:
    right 260ms var(--ease-plain),
    background-color var(--duration-base) var(--ease-plain),
    color var(--duration-base) var(--ease-plain),
    transform 100ms ease-out;
}
.detail-tab:hover {
  background: var(--color-surface-2);
  color: var(--color-ink);
}
.detail-tab:active {
  transform: translateY(-50%) scale(0.94);
}
.detail-tab:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
.detail-panel.collapsed .detail-handle {
  display: none;
}
.detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}
/* 左缘拖拽把手:伪元素语义改为真实元素,加宽命中区,视觉仍是面板边线 */
.detail-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  width: 8px;
  cursor: col-resize;
  z-index: 1;
}
.detail-slide-enter-active,
.detail-slide-leave-active {
  /* deslop-ignore-next-line 26 */
  transition:
    transform 240ms var(--ease-plain),
    width 260ms var(--ease-plain);
}
.detail-slide-enter-from,
.detail-slide-leave-to {
  transform: translateX(105%);
}
@media (prefers-reduced-motion: reduce) {
  .detail-slide-enter-active,
  .detail-slide-leave-active {
    transition: none;
  }
  .detail-slide-enter-from,
  .detail-slide-leave-to {
    transform: none;
  }
  .detail-panel {
    transition: none;
  }
  .detail-tab {
    transition: none;
  }
  .detail-contents {
    transition: none;
  }
}

/* 分组标题:同时是拖放目标 —— 悬停拖拽时整行给出明确的落点反馈 */
.asset-group {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 18px;
  padding: 5px 8px;
  border: 1px dashed transparent;
  border-radius: 7px;
  color: var(--color-ink-2);
  font-size: calc(12px * var(--ui-font-scale));
  transition:
    border-color var(--duration-base) var(--ease-plain),
    background-color var(--duration-base) var(--ease-plain),
    color var(--duration-base) var(--ease-plain);
}
.asset-group:hover {
  background: var(--color-surface-2);
}
.asset-group.is-empty {
  border-color: var(--color-line);
  border-style: dashed;
}
.asset-group.is-drop {
  border-color: var(--color-accent);
  border-style: dashed;
  background: var(--color-surface-2);
  color: var(--color-ink);
}
.asset-group-empty {
  margin-top: 6px;
  padding: 6px 8px;
  color: var(--color-ink-3);
  font-size: calc(11.5px * var(--ui-font-scale));
}

/* 框选矩形:细描边 + 极淡填充,不遮盖下方内容 */
.marquee {
  position: absolute;
  z-index: 5;
  border: 1px solid var(--color-accent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  pointer-events: none;
}

.asset-card {
  cursor: pointer;
  border-radius: 10px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  padding: 6px;
  transition:
    border-color var(--duration-base) var(--ease-plain),
    background-color var(--duration-base) var(--ease-plain);
}
.asset-card:hover {
  background: var(--color-surface-2);
}
.asset-card.selected {
  border-color: var(--color-accent);
}
/* 拖拽中的卡片半透明,让落点与拖动的对象都看得清 */
.asset-card.dragging,
.asset-row.dragging {
  opacity: 0.45;
}
.asset-card .thumb {
  aspect-ratio: 4 / 3;
  border-radius: 6px;
  background:
    repeating-conic-gradient(var(--color-surface-2) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
  overflow: hidden;
}
.asset-card .thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.thumb-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  text-align: center;
  font-size: calc(11px * var(--ui-font-scale));
  color: var(--color-ink-3);
  background: var(--color-surface-2);
  overflow: hidden;
}
.asset-card .actions {
  opacity: 0;
  transition: opacity var(--duration-base) var(--ease-plain);
}
.asset-card:hover .actions,
.asset-card.selected .actions {
  opacity: 1;
}

.ref-count {
  font-size: calc(10.5px * var(--ui-font-scale));
  color: var(--color-ink-3);
}
.ref-count.zero {
  color: var(--color-ink-3);
  opacity: 0.7;
}

.detail-preview {
  aspect-ratio: 4 / 3;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background:
    repeating-conic-gradient(var(--color-surface-2) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
  overflow: hidden;
}
.detail-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.ref-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-ink-2);
  font-size: calc(12.5px * var(--ui-font-scale));
  cursor: pointer;
  transition: background-color var(--duration-base) var(--ease-plain);
}
.ref-row:hover {
  background: var(--color-surface-2);
  color: var(--color-ink);
}
/* 列表视图:缩略图 + 名称/路径 + 大小 + 引用数 + 操作 */
.asset-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  cursor: pointer;
  transition:
    background-color var(--duration-base) var(--ease-plain),
    border-color var(--duration-base) var(--ease-plain);
}
.asset-row:hover {
  background: var(--color-surface-2);
}
.asset-row.selected {
  border-color: var(--color-accent);
}
.asset-row .row-thumb {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-surface-2);
}
.asset-row .row-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
