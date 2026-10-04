<script setup lang="ts">
/** 编辑器实时预览 -- iframe 内完整渲染,与构建同一管线(预览即产出) */
import { onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useEditorStore } from "@/stores/editor";
import { useSiteStore } from "@/stores/site";
import { useThemeStore } from "@/stores/theme";
import { useUiStore } from "@/stores/ui";
import { useAppStore } from "@/stores/app";
import { ipc } from "@/ipc/ipc";
import { renderPreview } from "@/lib/builder";
import { joinPosix, stripExt } from "@/lib/paths";

const { t } = useI18n();
const editor = useEditorStore();
const site = useSiteStore();
const theme = useThemeStore();
const ui = useUiStore();
const app = useAppStore();

const frame = ref<HTMLIFrameElement>();

let timer: ReturnType<typeof setTimeout> | null = null;
let pendingHtml = "";
let ready = false;

function computeHtml(): string {
  if (!editor.activePath || !site.config || !theme.activeBundle) return "";
  // 传原始内容,renderPreview 内统一解析 front-matter(标题/正文)
  return renderPreview(
    site.config,
    theme.activeBundle,
    site.tree,
    site.docsCache,
    editor.activePath,
    editor.content,
    app.platform,
    site.pluginContents,
    app.settings.disableRefreshAnim ?? false,
  );
}

/** 写入 iframe 并保持滚动位置 */
function applyHtml(next: string) {
  const win = frame.value?.contentWindow;
  const doc = frame.value?.contentDocument;
  if (!win || !doc) return;
  const savedScroll = win.scrollY;
  doc.open();
  doc.write(next);
  doc.close();
  win.scrollTo(0, savedScroll);
  attachClickHandlers();
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    pendingHtml = computeHtml();
    if (ready) applyHtml(pendingHtml);
  }, 240);
}

watch(
  [
    () => editor.content,
    () => editor.activePath,
    () => theme.activeBundle,
    () => site.config,
    () => site.tree,
    // 文档内容的外部写回(文件树配置头保存、资产页重命名同步等)也刷新文章流
    () => site.docsCache,
  ],
  schedule,
  { immediate: true },
);

onMounted(() => {
  // about:blank 就绪后写入首次内容
  const init = () => {
    ready = true;
    applyHtml(pendingHtml);
  };
  if (frame.value?.contentDocument?.readyState === "complete") init();
  else frame.value?.addEventListener("load", init, { once: true });
});

/** 站内链接 -> 打开对应文档;外链 -> 系统浏览器。
 *  页面脚本已在预览中运行(主题交互、目录高亮、搜索/灯箱插件与产物一致),
 *  锚点与按钮交给页面自身脚本处理,宿主只接管会脱离预览的导航 */
function attachClickHandlers() {
  const doc = frame.value?.contentDocument;
  if (!doc) return;
  doc.addEventListener("click", (e) => {
    const el = e.target as HTMLElement | null;
    const anchor = el?.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (/^https?:/i.test(href)) {
      e.preventDefault();
      void ipc.openExternal(href);
      return;
    }
    if (href.startsWith("#")) return; // 页内锚点:页面脚本/原生跳转自理
    e.preventDefault();
    const target = anchor.getAttribute("data-doc") ?? resolveInternal(href);
    const node = target ? site.findDoc(target) : null;
    if (node) {
      void editor.openDoc(node);
      return;
    }
    // 站内链接但预览无法呈现(如分页页 page/N)
    ui.toast(t("build.previewOnly"), "info");
  });
}

/** 无 data-doc 的相对链接(主题模板生成的 .html 链接/文件夹链接)解析为文档路径 */
function resolveInternal(href: string): string | null {
  if (!editor.activePath || href.startsWith("http")) return null;
  const clean = decodeURIComponent(href.split("#")[0]).replace(/\/+$/, "");
  if (!clean || clean === ".") return "index.md";
  const base = editor.activePath.includes("/")
    ? editor.activePath.slice(0, editor.activePath.lastIndexOf("/"))
    : "";
  const resolved = joinPosix(base, clean);
  // 指向具体页面(导航/prev/next) -> 同名文档;指向目录 -> 目录落地页
  if (/\.html?$/i.test(resolved)) return stripExt(resolved) + ".md";
  return `${resolved}/index.md`;
}

/** 供父组件做编辑器滚动同步 */
function scrollToRatio(ratio: number) {
  const win = frame.value?.contentWindow;
  const doc = frame.value?.contentDocument;
  if (!win || !doc) return;
  const max = doc.documentElement.scrollHeight - win.innerHeight;
  if (max > 0) win.scrollTo({ top: ratio * max });
}

defineExpose({ scrollToRatio });
</script>

<template>
  <!-- 同源沙箱:宿主可写入/滚动/拦截导航;allow-scripts 让页面脚本
       (主题交互、目录高亮、搜索/灯箱插件)照常运行,预览行为与产物一致 -->
  <iframe
    ref="frame"
    class="doc-preview h-full w-full border-0"
    title="preview"
    sandbox="allow-same-origin allow-scripts"
  />
</template>
