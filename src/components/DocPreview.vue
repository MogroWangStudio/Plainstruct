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
import { scrollToAnchor } from "@/lib/preview";
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
  attachScrollBehavior();
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

/** 站内链接 -> 打开对应文档;外链 -> 系统浏览器;
 *  按钮/无法在预览中打开的链接 -> 提示仅供预览 */
function attachClickHandlers() {
  const doc = frame.value?.contentDocument;
  if (!doc) return;
  doc.addEventListener("click", (e) => {
    const el = e.target as HTMLElement | null;
    const anchor = el?.closest("a");
    // 按钮元素(主题的抽屉开关/折叠按钮等)在预览中无交互
    if (!anchor) {
      if (el?.closest("button,[role='button']")) {
        e.preventDefault();
        ui.toast(t("build.previewOnly"), "info");
      }
      return;
    }
    const href = anchor.getAttribute("href") ?? "";
    if (/^https?:/i.test(href)) {
      e.preventDefault();
      void ipc.openExternal(href);
      return;
    }
    if (href.startsWith("#")) {
      // 目录/页内锚点:预览 iframe 不执行其中脚本,由宿主代为滚动到标题
      e.preventDefault();
      scrollToAnchor(doc, href);
      return;
    }
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

/** 预览 iframe 不执行主题脚本,这里补上「滚动后顶栏变形」的等效行为,
 *  使顶栏形态与变形后宽度在编辑器预览里也能看到 */
function attachScrollBehavior() {
  const win = frame.value?.contentWindow;
  const doc = frame.value?.contentDocument;
  if (!win || !doc) return;
  const bar = doc.querySelector(".blog-topbar");
  if (!bar) return;
  const sync = () => bar.classList.toggle("is-scrolled", (win.scrollY || 0) > 24);
  win.addEventListener("scroll", sync, { passive: true });
  sync();
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
  <!-- sandbox 保留同源(宿主可写入/滚动/拦截点击),但禁用其中脚本:
       markdown 裸 HTML 与主题 JS 不在应用特权上下文执行 -->
  <iframe
    ref="frame"
    class="doc-preview h-full w-full border-0"
    title="preview"
    sandbox="allow-same-origin"
  />
</template>
