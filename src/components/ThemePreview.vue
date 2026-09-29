<script setup lang="ts">
/** 主题实时预览 -- 制作器中编辑草稿优先,否则当前主题;完整布局渲染页面。
 *  站内链接就地切换预览页面(不脱离预览),外链交系统浏览器。 */
import { onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useThemeStore } from "@/stores/theme";
import { useSiteStore } from "@/stores/site";
import { useAppStore } from "@/stores/app";
import { useUiStore } from "@/stores/ui";
import { ipc } from "@/ipc/ipc";
import { renderPreview, collectDocPaths } from "@/lib/builder";
import { joinPosix, stripExt } from "@/lib/paths";
import type { ThemeBundle } from "@/lib/theme-engine";
import type { ThemeMeta } from "@/ipc/types";

/** followEditing:制作器 tab 传 true,预览跟随编辑草稿;其余场景渲染当前激活主题 */
const props = defineProps<{ followEditing?: boolean }>();

const { t } = useI18n();
const theme = useThemeStore();
const site = useSiteStore();
const app = useAppStore();
const ui = useUiStore();

const frame = ref<HTMLIFrameElement>();
let timer: ReturnType<typeof setTimeout> | null = null;
let ready = false;
/** 就绪前到达的变更,就绪后立即补一次渲染 */
let pending = false;
/** 当前预览的页面(点击站内导航后切换,数据变更重渲染时保持) */
let currentPath = "";

/** 编辑中的草稿(实时含未保存修改),否则当前主题 */
function currentBundle(): ThemeBundle | null {
  if (props.followEditing && theme.editing) {
    const base = theme.customMetas.find((m) => m.id === theme.editing!.id);
    let meta: ThemeMeta = base ?? {
      id: theme.editing.id,
      name: theme.editing.name,
      version: "0.0.0",
      config: [],
      source: "custom",
    };
    try {
      meta = { ...meta, ...JSON.parse(theme.editing.files["theme.json"] ?? "{}") };
    } catch {
      /* theme.json 草稿暂不合法时沿用旧 meta */
    }
    return { meta, files: theme.editing.files };
  }
  return theme.activeBundle;
}

function apply() {
  const bundle = currentBundle();
  const doc = frame.value?.contentDocument;
  if (!doc || !site.config || !bundle) return;
  const paths = collectDocPaths(site.tree);
  if (!paths.length) return;
  const page = currentPath && paths.includes(currentPath) ? currentPath : paths.includes("index.md") ? "index.md" : paths[0];
  currentPath = page;
  let html = "";
  try {
    html = renderPreview(site.config, bundle, site.tree, site.docsCache, page, undefined, app.platform);
  } catch {
    html = "<p style='font:13px system-ui;padding:16px;color:var(--color-danger)'>模板渲染出错,请检查语法。</p>";
  }
  doc.open();
  doc.write(html);
  doc.close();
  // document.open 会清空文档及其监听,每次写入后重新挂接
  attachLinks();
}

/** 站内链接 -> 就地切换预览页面;外链 -> 系统浏览器;
 *  按钮/无法呈现的页面(分页页等) -> 提示仅供预览。
 *  不拦截的话,iframe 会脱离 about:blank 导航到应用自身 origin 上
 *  不存在的路径,预览就此白屏且不自愈 */
function attachLinks() {
  const doc = frame.value?.contentDocument;
  if (!doc) return;
  doc.addEventListener("click", (e) => {
    const el = e.target as HTMLElement | null;
    const anchor = el?.closest("a");
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
    if (href.startsWith("#")) return; // 锚点跳转交给 iframe 自身
    e.preventDefault();
    const target = resolveInternal(href);
    if (target && collectDocPaths(site.tree).includes(target)) {
      currentPath = target;
      apply();
      return;
    }
    ui.toast(t("build.previewOnly"), "info");
  });
}

/** 相对链接(主题模板生成的 .html 链接/文件夹链接)按当前预览页面解析为文档路径 */
function resolveInternal(href: string): string | null {
  const clean = decodeURIComponent(href.split("#")[0]).replace(/\/+$/, "");
  if (!clean || clean === ".") return "index.md";
  const base = currentPath.includes("/")
    ? currentPath.slice(0, currentPath.lastIndexOf("/"))
    : "";
  const resolved = joinPosix(base, clean);
  if (/\.html?$/i.test(resolved)) return stripExt(resolved) + ".md";
  return `${resolved}/index.md`;
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (ready) apply();
    else pending = true;
  }, 300);
}

/** 立即重渲染(供刷新按钮;忽略防抖) */
function refresh() {
  if (timer) clearTimeout(timer);
  if (ready) apply();
  else pending = true;
}

defineExpose({ refresh });

watch(
  [
    () => props.followEditing,
    () => theme.editing?.files,
    () => theme.activeBundle,
    () => site.config,
    () => site.tree,
    () => site.docsCache,
  ],
  schedule,
  { deep: true, immediate: true },
);

onMounted(() => {
  const init = () => {
    ready = true;
    apply();
    if (pending) {
      pending = false;
      apply();
    }
  };
  if (frame.value?.contentDocument?.readyState === "complete") init();
  else frame.value?.addEventListener("load", init, { once: true });
});
</script>

<template>
  <!-- sandbox 保留同源(宿主可写入并拦截点击),但禁用其中脚本:
       第三方主题模板与 JS 不在应用特权上下文执行 -->
  <iframe ref="frame" class="theme-preview h-full w-full border-0" title="theme preview" sandbox="allow-same-origin" />
</template>
