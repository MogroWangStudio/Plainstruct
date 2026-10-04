<script setup lang="ts">
/** 构建产物预览:Tauri 下走 site:// 协议(与发布完全一致),浏览器 mock 降级为可导航的单页渲染 */
import { computed, onMounted, ref, watch } from "vue";
import { useAppStore } from "@/stores/app";
import { useBuilderStore } from "@/stores/builder";
import { useSiteStore } from "@/stores/site";
import { useThemeStore } from "@/stores/theme";
import { ipc } from "@/ipc/ipc";
import { buildIndexUrl } from "@/lib/preview";
import { renderPreview, collectDocPaths } from "@/lib/builder";
import { dirname, mdToHtml } from "@/lib/paths";

const app = useAppStore();
const builder = useBuilderStore();
const site = useSiteStore();
const theme = useThemeStore();

const frame = ref<HTMLIFrameElement>();

/** mock 预览当前渲染的文档(content/ 相对路径) */
let mockPath = "";

const src = computed(() => (ipc.inTauri ? buildIndexUrl(app.platform) : "about:blank"));

const reloadKey = computed(() => builder.previewNonce);

/** mock 预览的默认落点:站点首页,没有 index.md 时取第一篇文档 */
function mockHomePath(paths: string[]): string {
  const hit = paths.find((p) => p.toLowerCase() === "index.md");
  return hit ?? paths[0] ?? "";
}

/** mock 模式:渲染当前文档写入 iframe */
function applyMock() {
  if (ipc.inTauri || !frame.value) return;
  const paths = collectDocPaths(site.tree);
  if (!paths.length || !site.config || !theme.activeBundle) return;
  if (!paths.includes(mockPath)) mockPath = mockHomePath(paths);
  const html = renderPreview(site.config, theme.activeBundle, site.tree, site.docsCache, mockPath, undefined, app.platform, site.pluginContents, app.settings.disableRefreshAnim ?? false);
  const doc = frame.value.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  attachMockLinks(doc, paths);
}

/**
 * mock 预览写在 about:blank 里,页面内相对链接会以应用地址为 base,
 * 不拦截的话点击主链接/导航会把 iframe 带离预览、跳到应用自身页面。
 * 站内链接改为就地渲染目标文档,外链交给系统浏览器。
 * document.open() 会清空全部事件监听器,因此每次写入后都要重挂。
 */
function attachMockLinks(doc: Document, paths: string[]) {
  doc.addEventListener("click", (e) => {
    const anchor = (e.target as HTMLElement | null)?.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (/^https?:/i.test(href)) {
      e.preventDefault();
      void ipc.openExternal(href);
      return;
    }
    if (href.startsWith("#")) return; // 页内锚点交给 iframe 自身
    e.preventDefault();
    const target = resolveMockDoc(anchor.href, paths);
    if (target) {
      mockPath = target;
      applyMock();
    }
  });
}

/** iframe 内解析后的绝对 URL -> content/ 下的 md 路径;自动目录页落到该目录第一篇 */
function resolveMockDoc(absoluteHref: string, paths: string[]): string | null {
  let htmlPath: string;
  try {
    htmlPath = decodeURIComponent(new URL(absoluteHref).pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (!/\.html?$/i.test(htmlPath)) return null;
  const hit = paths.find((p) => mdToHtml(p) === htmlPath);
  if (hit) return hit;
  // 没有 index.md 的目录页(dir/index.html)没有对应文档,落到目录内第一篇
  if (htmlPath.toLowerCase() === "index.html") return mockHomePath(paths);
  if (/\/index\.html?$/i.test(htmlPath)) {
    const dir = htmlPath.replace(/index\.html?$/i, "").replace(/\/$/, "");
    return paths.find((p) => dirname(p) === dir) ?? null;
  }
  return null;
}

/** 重新加载站点(协议响应带 no-store,重设 src 即取最新产物) */
function reloadSite() {
  if (!frame.value) return;
  // iframe 与应用跨源,不能调用 contentWindow.location.reload(),重设 src 触发重新导航
  frame.value.src = src.value;
}

onMounted(applyMock);

watch(reloadKey, () => {
  if (ipc.inTauri) {
    reloadSite();
  } else {
    // 构建后回到首页,与 Tauri 模式重设 src 的行为一致
    mockPath = "";
    applyMock();
  }
});
</script>

<template>
  <iframe
    ref="frame"
    :src="src"
    class="h-full w-full border-0 bg-surface"
    title="site preview"
  />
</template>
