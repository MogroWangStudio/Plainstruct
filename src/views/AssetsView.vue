<script setup lang="ts">
/** 资产页 -- 管理站点 asset 文件夹(兼容旧 images)中的图片:预览、重命名(联动更新引用)、删除、查找引用 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { collectDocPaths } from "@/lib/builder";
import { formatSize } from "@/lib/format";
import { countImageRefs, findImageRefs, replaceImageRefs, type ImageRef } from "@/lib/imageRefs";
import { basename } from "@/lib/paths";
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

const { t } = useI18n();
const app = useAppStore();
const site = useSiteStore();
const editor = useEditorStore();
const ui = useUiStore();

/** 站点资产(asset,兼容旧 images)下的图片文件(与构建复制同源) */
const images = computed<TreeNode[]>(() => site.assetFiles);

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

const refCounts = computed(() =>
  countImageRefs(images.value.map((n) => n.path), Object.keys(docs.value), docs.value),
);

/* ---------- 选中与引用详情 ---------- */

const selected = ref<string | null>(null);

/* ---------- 详情窗宽度可拖拽(右侧面板) ---------- */
const splitHost = ref<HTMLElement>();
const detailW = ref(300);

function onDividerDown(e: PointerEvent) {
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onDividerMove(e: PointerEvent) {
  if (!(e.buttons & 1) || !splitHost.value) return;
  const rect = splitHost.value.getBoundingClientRect();
  // 界面缩放档位下指针与 rect 均为视觉像素,宽度声明值经 toCssPx 还原
  detailW.value = Math.min(520, Math.max(220, toCssPx(rect.right - e.clientX)));
}
const selectedRefs = computed<ImageRef[]>(() =>
  selected.value ? findImageRefs(selected.value, Object.keys(docs.value), docs.value) : [],
);

const selectedNode = computed(() => images.value.find((i) => i.path === selected.value));
/** 选中文件的字节数(TreeNode.size,目录/未知为 undefined) */
const selectedSize = computed(() => selectedNode.value?.size);

function select(path: string) {
  selected.value = selected.value === path ? null : path;
}

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
let askResolve: ((v: string | null) => void) | null = null;

function askName(current: string): Promise<string | null> {
  askValue.value = current;
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
    if (selected.value === img.path) selected.value = newPath;
    // 替换全部落盘后重读一次,保证引用计数与磁盘一致(树刷新触发的读取可能早于保存)
    await loadDocs();
    ui.toast(t("assets.renamed", { name: newName }), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

/* ---------- 删除(二级确认) ---------- */

async function remove(img: TreeNode) {
  const n = refCounts.value.get(img.path) ?? 0;
  const ok = await ui.confirmDialog({
    title: t("assets.deleteTitle"),
    body: n
      ? t("assets.deleteBodyReferenced", { name: img.name, n })
      : t("assets.deleteBody", { name: img.name }),
    danger: true,
    confirmText: t("common.delete"),
  });
  if (!ok) return;
  try {
    await site.deleteItem(img.path);
    if (selected.value === img.path) selected.value = null;
    ui.toast(t("assets.deleted", { name: img.name }), "success");
  } catch (e) {
    ui.toast(t("ui.operationFailed", { msg: ipc.errText(e) }), "error");
  }
}

function thumbUrl(path: string): string {
  // 浏览器 mock 无 site:// 资源服务:返回空让 <img> 以 alt(文件名)占位
  return app.platform === "browser" ? "" : siteUrl(app.platform, `content/${path}`);
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
      <button class="btn-icon ml-auto !h-8 !w-8" :title="t('common.refresh')" @click="loadDocs">
        <AppIcon name="refresh" :size="15" />
      </button>
    </header>

    <!-- 左:图片网格 | 右:详情窗(宽度可拖拽) -->
    <div ref="splitHost" class="flex min-h-0 flex-1">
    <div class="min-w-0 flex-1 overflow-y-auto p-5">
      <p v-if="!images.length" class="rounded-lg border border-dashed border-line px-4 py-10 text-center text-[calc(13px*var(--ui-font-scale))] leading-relaxed text-ink-3">
        {{ t("assets.empty") }}
      </p>

      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        <div
          v-for="img in images"
          :key="img.path"
          class="asset-card"
          :class="{ selected: selected === img.path }"
          @click="select(img.path)"
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
                <button class="btn-icon !h-6 !w-6 hover:!text-danger" :title="t('common.delete')" @click.stop="remove(img)">
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
    </div>

    <!-- 右:详情窗(引用位置以列表呈现) -->
    <template v-if="selected">
      <div class="divider w-px shrink-0 cursor-col-resize bg-line" @pointerdown="onDividerDown" @pointermove="onDividerMove" />
      <aside class="shrink-0 overflow-y-auto border-l border-line bg-surface px-4 py-4" :style="{ width: detailW + 'px' }">
        <div class="flex items-center gap-1">
          <span class="min-w-0 flex-1 truncate text-[calc(13.5px*var(--ui-font-scale))] font-semibold" :title="basename(selected)">{{ basename(selected) }}</span>
          <button v-if="selectedNode" class="btn-icon !h-7 !w-7" :title="t('assets.rename')" @click="rename(selectedNode)">
            <AppIcon name="pencil" :size="14" />
          </button>
          <button v-if="selectedNode" class="btn-icon !h-7 !w-7 hover:!text-danger" :title="t('common.delete')" @click="remove(selectedNode)">
            <AppIcon name="trash" :size="14" />
          </button>
          <button class="btn-icon !h-7 !w-7" :title="t('common.close')" @click="selected = null">
            <AppIcon name="x" :size="14" />
          </button>
        </div>

        <div class="detail-preview mt-3">
          <img
            v-if="thumbUrl(selected) && !brokenThumbs.has(selected)"
            :key="selected"
            :src="thumbUrl(selected)"
            :alt="basename(selected)"
            @error="brokenThumbs.add(selected)"
          />
          <span v-else class="thumb-fallback h-full w-full">{{ basename(selected) }}</span>
        </div>
        <p class="mono mt-2 break-all text-[calc(11px*var(--ui-font-scale))] text-ink-3">{{ selected }}</p>
        <!-- 详细大小:人类可读 + 精确字节 -->
        <p v-if="selectedSize != null" class="mono mt-1 text-[calc(11px*var(--ui-font-scale))] text-ink-3">
          {{ formatSize(selectedSize) }} · {{ selectedSize.toLocaleString("en-US") }} B
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
      </aside>
    </template>

    </div>

    <!-- 重命名 -->
    <PromptModal
      :open="askOpen"
      :title="t('assets.renameTitle')"
      :label="t('assets.renameLabel')"
      :initial="askValue"
      :confirm-text="t('common.rename')"
      @confirm="onAskConfirm"
      @cancel="onAskCancel"
    />
  </div>
</template>

<style scoped>
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
</style>
