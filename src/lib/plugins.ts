/** 站点插件管线 -- 内置插件(搜索/图片预览)与用户导入插件的统一注入。
 *  构建产物:插件文件写入 build/,页面注入引用标签;
 *  预览(mock):插件内容与搜索索引直接内联进 HTML,行为与产物一致。 */
import searchCss from "@/plugins/ps-search.css?raw";
import searchJs from "@/plugins/ps-search.js?raw";
import imgPreviewCss from "@/plugins/ps-imgpreview.css?raw";
import imgPreviewJs from "@/plugins/ps-imgpreview.js?raw";
import type { SiteConfig, SitePluginEntry, SitePluginFiles } from "@/ipc/types";
import { encodePath } from "./paths";

/** 图片预览的默认标记类:带该 class(或经配置改名)的图片才可点击预览 */
export const IMG_PREVIEW_MARK = "mws_ps_imgpreview";

/** 内置插件在产物内的路径 -> 内容 */
export const BUILTIN_PLUGIN_FILES: Record<string, string> = {
  "assets/ps-plugins/ps-search.css": searchCss,
  "assets/ps-plugins/ps-search.js": searchJs,
  "assets/ps-plugins/ps-imgpreview.css": imgPreviewCss,
  "assets/ps-plugins/ps-imgpreview.js": imgPreviewJs,
};

/** 站点插件配置(旧站点缺省:内置插件全开、无自定义插件) */
export function normalizePlugins(site: SiteConfig): {
  search: boolean;
  imgPreview: boolean;
  imgPreviewRequireMark: string;
  searchStyle: "button" | "bar";
  searchPosition: "bottom-right" | "bottom-left" | "topbar";
  /** 移动端独立设置,缺省沿用 PC 配置 */
  searchStyleM?: "button" | "bar";
  searchPositionM?: "bottom-right" | "bottom-left" | "topbar";
  /** 文本框搜索栏宽度(px):缺省用样式默认值,160–420 越界收敛 */
  searchBarWidth?: number;
  /** 移动端搜索栏宽度(px),缺省沿用 PC 配置 */
  searchBarWidthM?: number;
  custom: SitePluginEntry[];
} {
  const p = site.plugins ?? {};
  return {
    search: p.search ?? true,
    imgPreview: p.imgPreview ?? true,
    // 默认开启标记模式(内置约定类名);用户清空该字段则对所有正文图片生效
    imgPreviewRequireMark: typeof p.imgPreviewRequireMark === "string" ? p.imgPreviewRequireMark.trim() : IMG_PREVIEW_MARK,
    searchStyle: p.searchStyle === "bar" ? "bar" : "button",
    searchPosition: p.searchPosition === "bottom-left" || p.searchPosition === "topbar" ? p.searchPosition : "bottom-right",
    searchStyleM: p.searchStyleM === "bar" || p.searchStyleM === "button" ? p.searchStyleM : undefined,
    searchBarWidth: (() => {
      const n = Math.floor(Number(p.searchBarWidth));
      return Number.isFinite(n) && n > 0 ? Math.min(420, Math.max(160, n)) : undefined;
    })(),
    searchBarWidthM: (() => {
      const n = Math.floor(Number(p.searchBarWidthM));
      return Number.isFinite(n) && n > 0 ? Math.min(420, Math.max(160, n)) : undefined;
    })(),
    searchPositionM:
      p.searchPositionM === "bottom-left" || p.searchPositionM === "topbar" || p.searchPositionM === "bottom-right"
        ? p.searchPositionM
        : undefined,
    custom: Array.isArray(p.custom) ? p.custom : [],
  };
}

/** 启用中的用户插件条目(构建拷贝与预览内联共用) */
export function enabledPlugins(site: SiteConfig): SitePluginEntry[] {
  return normalizePlugins(site).custom.filter((e) => e.enabled);
}

function pluginLink(prefix: string, path: string): string {
  return `<link rel="stylesheet" href="${prefix}${encodePath(path)}">`;
}

function pluginScript(prefix: string, path: string, attrs = ""): string {
  return `<script src="${prefix}${encodePath(path)}"${attrs}></script>`;
}

/**
 * 产物页面的插件引用标签(按页面深度给 prefix,与主题资产同规则)。
 * 顺序:内置样式 → 用户插件文件(保持导入顺序,作者可控) → 内置脚本。
 */
export function pluginTags(prefix: string, site: SiteConfig): string[] {
  const p = normalizePlugins(site);
  const tags: string[] = [];
  if (p.imgPreview) tags.push(pluginLink(prefix, "assets/ps-plugins/ps-imgpreview.css"));
  if (p.search) tags.push(pluginLink(prefix, "assets/ps-plugins/ps-search.css"));
  for (const entry of p.custom) {
    if (!entry.enabled) continue;
    for (const file of entry.files) {
      const path = `assets/plugins/${entry.id}/${file}`;
      tags.push(
        file.toLowerCase().endsWith(".css") ? pluginLink(prefix, path) : pluginScript(prefix, path),
      );
    }
  }
  if (p.imgPreview) {
    const mark = p.imgPreviewRequireMark ? ` data-require-mark="${p.imgPreviewRequireMark.replace(/"/g, "&quot;")}"` : "";
    tags.push(pluginScript(prefix, "assets/ps-plugins/ps-imgpreview.js", mark));
  }
  if (p.search) {
    tags.push(
      pluginScript(
        prefix,
        "assets/ps-plugins/ps-search.js",
        ` data-index-url="${prefix}${encodePath("assets/ps-plugins/search-index.json")}" data-root-prefix="${prefix}"` +
          ` data-style="${p.searchStyle}" data-position="${p.searchPosition}"` +
          (p.searchBarWidth !== undefined ? ` data-bar-width="${p.searchBarWidth}"` : "") +
          (p.searchBarWidthM !== undefined ? ` data-bar-width-m="${p.searchBarWidthM}"` : "") +
          (p.searchStyleM ? ` data-style-m="${p.searchStyleM}"` : "") +
          (p.searchPositionM ? ` data-position-m="${p.searchPositionM}"` : ""),
      ),
    );
  }
  return tags;
}

/** 把标签插到 </body> 之前(从末尾查找,正文中的字面 </body> 不受影响;未闭合时兜底追加) */
export function injectPluginTags(html: string, tags: string[]): string {
  if (!tags.length) return html;
  const block = tags.join("\n") + "\n";
  const idx = html.lastIndexOf("</body>");
  if (idx >= 0) return html.slice(0, idx) + block + html.slice(idx);
  return html + block;
}

/** 构建产物需要写出的内置插件文件(只写启用的,产物不留死文件) */
export function builtinPluginOutputs(site: SiteConfig): { path: string; content: string }[] {
  const p = normalizePlugins(site);
  const out: { path: string; content: string }[] = [];
  for (const [path, content] of Object.entries(BUILTIN_PLUGIN_FILES)) {
    if (path === "assets/ps-plugins/ps-search.css" && !p.search) continue;
    if (path === "assets/ps-plugins/ps-search.js" && !p.search) continue;
    if (path === "assets/ps-plugins/ps-imgpreview.css" && !p.imgPreview) continue;
    if (path === "assets/ps-plugins/ps-imgpreview.js" && !p.imgPreview) continue;
    out.push({ path, content });
  }
  return out;
}

/** 用户插件的产物拷贝项(从 .plainstruct/plugins/<id>/ 拷入 build/assets/plugins/) */
export function pluginCopyItems(site: SiteConfig): { src: string; dest: string }[] {
  return enabledPlugins(site).flatMap((entry) =>
    entry.files.map((file) => ({
      src: `.plainstruct/plugins/${entry.id}/${file}`,
      dest: `assets/plugins/${entry.id}/${file}`,
    })),
  );
}

/* ---------- 搜索索引 ---------- */

export interface SearchPage {
  title: string;
  url: string;
  desc?: string;
  text: string;
}

/** 渲染后的页面 HTML -> 可搜索纯文本(去样式/脚本/标签,截断) */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

/** Markdown 原文 -> 可搜索纯文本(预览通道不渲染全站页面,从源文提取) */
export function mdToText(body: string): string {
  return body
    .replace(/^---\n[\s\S]*?\n---/, " ")
    .replace(/^```[a-zA-Z0-9_-]*[ \t]*$/gm, " ")
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/[#>*_~`|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

/** 预览内联的搜索数据标签:JSON 全量转义 <,杜绝 </script> 提前闭合 */
export function searchIndexTag(pages: SearchPage[]): string {
  const json = JSON.stringify({ pages }).replace(/</g, "\\u003c");
  return `<script type="application/json" id="ps-search-data">${json}</script>`;
}

/* ---------- 预览内联 ---------- */

/** 预览通道:插件样式/脚本与搜索索引内联为标签(无外部请求,行为对齐构建产物) */
export function inlinePreviewPlugins(site: SiteConfig, contents: SitePluginFiles[]): string[] {
  const p = normalizePlugins(site);
  const tags: string[] = [];
  const style = (css: string) => `<style>\n${css}\n</style>`;
  const script = (js: string) => `<script>\n${js}\n</script>`;
  if (p.imgPreview) tags.push(style(imgPreviewCss));
  if (p.search) tags.push(style(searchCss));
  for (const entry of p.custom) {
    if (!entry.enabled) continue;
    const files = contents.find((c) => c.id === entry.id)?.files ?? [];
    for (const file of files) {
      tags.push(file.name.toLowerCase().endsWith(".css") ? style(file.content) : script(file.content));
    }
  }
  if (p.imgPreview) {
    // 内联无 data 属性载体:标记模式由紧随其后的初始化脚本设置
    tags.push(script(imgPreviewJs));
    if (p.imgPreviewRequireMark) {
      const mark = JSON.stringify(p.imgPreviewRequireMark).replace(/</g, "\\u003c");
      tags.push(`<script>window.__psImgRequireMark=${mark};</script>`);
    }
  }
  if (p.search) {
    const cfg = JSON.stringify({ style: p.searchStyle, position: p.searchPosition, styleM: p.searchStyleM, positionM: p.searchPositionM, barWidth: p.searchBarWidth, barWidthM: p.searchBarWidthM }).replace(/</g, "\\u003c");
    tags.push(`<script>window.__psSearchCfg=${cfg};</script>`);
    tags.push(script(searchJs));
  }
  return tags;
}
