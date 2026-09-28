<script setup lang="ts">
/** 主题实时预览 -- 制作器中编辑草稿优先,否则当前主题;完整布局渲染首页 */
import { onMounted, ref, watch } from "vue";
import { useThemeStore } from "@/stores/theme";
import { useSiteStore } from "@/stores/site";
import { useAppStore } from "@/stores/app";
import { renderPreview, collectDocPaths } from "@/lib/builder";
import type { ThemeBundle } from "@/lib/theme-engine";
import type { ThemeMeta } from "@/ipc/types";

/** followEditing:制作器 tab 传 true,预览跟随编辑草稿;其余场景渲染当前激活主题 */
const props = defineProps<{ followEditing?: boolean }>();

const theme = useThemeStore();
const site = useSiteStore();
const app = useAppStore();

const frame = ref<HTMLIFrameElement>();
let timer: ReturnType<typeof setTimeout> | null = null;
let ready = false;
/** 就绪前到达的变更,就绪后立即补一次渲染 */
let pending = false;

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
  const first = paths.includes("index.md") ? "index.md" : paths[0];
  let html = "";
  try {
    html = renderPreview(site.config, bundle, site.tree, site.docsCache, first, undefined, app.platform);
  } catch {
    html = "<p style='font:13px system-ui;padding:16px;color:var(--color-danger)'>模板渲染出错,请检查语法。</p>";
  }
  doc.open();
  doc.write(html);
  doc.close();
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
  <!-- sandbox 保留同源(宿主可写入),但禁用其中脚本:
       第三方主题模板与 JS 不在应用特权上下文执行 -->
  <iframe ref="frame" class="theme-preview h-full w-full border-0" title="theme preview" sandbox="allow-same-origin" />
</template>
