/** Markdown 渲染 -- 编辑器预览与站点构建共用同一渲染器,预览即产出 */
import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/common";
import type { BuildWarning } from "@/ipc/types";
import { dirname, encodePath, isMarkdown, joinPosix, mdToHtml, relPosix } from "./paths";

export interface MdEnv {
  /** 当前文档在 content/ 内的路径 */
  currentMdPath: string;
  /** 全部 md 文档路径:小写 -> 原始大小写(content/ 相对) */
  docMap: Map<string, string>;
  /** 全部内容目录路径(小写) */
  dirSet: Set<string>;
  warnings: BuildWarning[];
  /** 编辑器预览模式:图片等资源改写为协议地址 */
  resolveAsset?: (resolvedPath: string) => string;
}

export function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

export function splitHash(href: string): [target: string, hash: string] {
  const i = href.indexOf("#");
  if (i === -1) return [href, ""];
  return [href.slice(0, i), href.slice(i)];
}

/** 站内链接解析:返回改写后的 href;docPath 命中文档时供预览跳转 */
function resolveLink(raw: string, env: MdEnv): { href: string; docPath?: string } | null {
  if (/^(https?:|mailto:|data:)/i.test(raw)) return null;
  const [target, hash] = splitHash(raw);
  if (!target) return null; // 纯锚点
  const decoded = decodeHref(target);
  if (/^(https?:|mailto:|data:)/i.test(decoded)) return null;

  const currentOutDir = dirname(mdToHtml(env.currentMdPath));
  const resolved = joinPosix(dirname(env.currentMdPath), decoded);

  if (resolved.startsWith("..")) {
    env.warnings.push({ source: env.currentMdPath, link: raw, message: "out-of-root" });
    return null;
  }

  if (isMarkdown(resolved)) {
    const canonical = env.docMap.get(resolved.toLowerCase());
    const href = relPosix(currentOutDir, mdToHtml(canonical ?? resolved)) + hash;
    if (!canonical) {
      env.warnings.push({ source: env.currentMdPath, link: raw, message: "missing" });
      return { href: encodePath(href) };
    }
    return { href: encodePath(href), docPath: canonical };
  }

  if (decoded.endsWith("/")) {
    // 文件夹链接:指向目录(index.html 由服务器解析)
    const dir = resolved.replace(/\/$/, "");
    if (env.dirSet.has(dir.toLowerCase())) {
      const href = (relPosix(currentOutDir, dir) || ".") + "/" + hash;
      return { href: encodePath(href) };
    }
    env.warnings.push({ source: env.currentMdPath, link: raw, message: "missing" });
    return null;
  }

  if (env.dirSet.has(resolved.toLowerCase()) && env.docMap.has(`${resolved.toLowerCase()}/index.md`)) {
    const href = (relPosix(currentOutDir, resolved) || ".") + "/" + hash;
    return { href: encodePath(href) };
  }

  // 其余(图片/附件等资源)按原相对路径引用,构建时 1:1 拷贝
  return null;
}

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  highlight(code, lang) {
    const language = lang?.trim().toLowerCase();
    if (language && hljs.getLanguage(language)) {
      try {
        return hljs.highlight(code, { language }).value;
      } catch {
        /* 回退到转义输出 */
      }
    }
    return "";
  },
});

/* ---------- 标题锚点 id ---------- */

let slugUsed: Map<string, number>;

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[\s.]+/g, "-")
    .replace(/[^\p{L}\p{N}_-]+/gu, "")
    .replace(/^-+|-+$/g, "");
  const base = slug || "h";
  const n = slugUsed.get(base) ?? 0;
  slugUsed.set(base, n + 1);
  return n === 0 ? base : `${base}-${n + 1}`;
}

md.renderer.rules.heading_open = (tokens, idx) => {
  const token = tokens[idx];
  const inline = tokens[idx + 1];
  const id = slugify(inline?.content ?? "");
  return `<${token.tag} id="${id}">`;
};

/* ---------- 任务列表 ---------- */

md.core.ruler.after("inline", "plainstruct-tasks", (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "list_item_open") continue;
    const li = tokens[i];
    for (let j = i + 1; j < tokens.length && tokens[j].type !== "list_item_close"; j++) {
      if (tokens[j].type !== "inline") continue;
      const children = tokens[j].children;
      if (!children || !children.length) continue;
      const first = children.find((t) => t.type === "text" && t.content.trim() !== "");
      if (!first) continue;
      const m = first.content.match(/^\[([ xX])\] +/);
      if (!m) continue;
      const checked = m[1].toLowerCase() === "x";
      first.content = first.content.slice(m[0].length);
      if (first.content === "") first.hidden = true;
      const box = new state.Token("html_inline", "", 0);
      box.content = `<input class="task-item" type="checkbox" disabled${checked ? " checked" : ""}>`;
      children.unshift(box);
      li.attrJoin("class", "task-list-item");
    }
  }
  return null;
});

/* ---------- 站内链接与资源改写 ---------- */

/** HTML 属性值里的常见实体:文件名中的 & 会以 &amp; 出现在裸 HTML 里 */
function decodeHtmlAttr(s: string): string {
  return s.replace(/&amp;/gi, "&");
}

/** 解析一个站内资源引用:出根/外链返回 null,其余返回 content/ 相对路径 */
function resolveAssetPath(raw: string, env: MdEnv): string | null {
  if (/^(https?:|data:)/i.test(raw)) return null;
  const resolved = joinPosix(dirname(env.currentMdPath), decodeHref(splitHash(raw)[0]));
  if (resolved.startsWith("..")) {
    env.warnings.push({ source: env.currentMdPath, link: raw, message: "out-of-root" });
    return null;
  }
  return resolved;
}

/** 裸 HTML <img>(html_block/html_inline)的 src 改写:与 Markdown 图片语法同流,
 *  经 resolveAsset 换算(预览绝对化为协议地址,构建换算为页面相对地址);
 *  对齐按钮插入的 <div align><img>、用户粘贴的 HTML 由此获得正确的预览路径 */
function rewriteHtmlImages(html: string, env: MdEnv): string {
  return html.replace(/<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi, (m, quote: string, raw: string) => {
    const resolved = resolveAssetPath(decodeHtmlAttr(raw), env);
    if (!resolved || !env.resolveAsset) return m;
    return m.slice(0, m.length - raw.length - 1) + env.resolveAsset(resolved) + quote;
  });
}

md.core.ruler.after("plainstruct-tasks", "plainstruct-links", (state) => {
  const env = state.env as MdEnv;
  if (!env?.docMap || !env?.warnings) return null;
  for (const block of state.tokens) {
    if (block.type === "html_block") {
      block.content = rewriteHtmlImages(block.content, env);
      continue;
    }
    if (block.type !== "inline" || !block.children) continue;
    for (const t of block.children) {
      if (t.type === "link_open") {
        const hrefIdx = t.attrIndex("href");
        if (hrefIdx < 0) continue;
        const raw = String(t.attrs![hrefIdx][1]);
        const hit = resolveLink(raw, env);
        if (hit) {
          t.attrs![hrefIdx][1] = hit.href;
          if (hit.docPath) t.attrSet("data-doc", hit.docPath);
        }
      } else if (t.type === "image") {
        const srcIdx = t.attrIndex("src");
        if (srcIdx < 0) continue;
        const resolved = resolveAssetPath(String(t.attrs![srcIdx][1]), env);
        if (resolved && env.resolveAsset) {
          t.attrs![srcIdx][1] = env.resolveAsset(resolved);
        }
      } else if (t.type === "html_inline") {
        t.content = rewriteHtmlImages(t.content, env);
      }
    }
  }
  return null;
});

/** 渲染正文(front-matter 已剥离) */
export function renderMarkdown(body: string, env: MdEnv): string {
  slugUsed = new Map();
  return md.render(preprocessHardBreakLines(body), env);
}

/** 把「仅由硬换行空格组成的行」(编辑器 Enter 在空行产生的 ¶ 行)转换为 <br>,
 *  否则 Markdown 会把仅空白的行当作段落分隔,硬换行标记在渲染中失效。代码块内不处理。 */
function preprocessHardBreakLines(body: string): string {
  const lines = body.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (!inFence && /^[ ]{2,}[ \t]*$/.test(lines[i])) lines[i] = "<br>";
  }
  return lines.join("\n");
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

/** 提取标题大纲(供编辑器侧栏) */
export function extractHeadings(body: string): Heading[] {
  slugUsed = new Map();
  const tokens = md.parse(body, {});
  const out: Heading[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].type.endsWith("_open")) continue;
    if (!/^h[1-6]$/.test(tokens[i].tag)) continue;
    const inline = tokens[i + 1];
    if (inline?.type !== "inline") continue;
    out.push({
      level: Number(tokens[i].tag.slice(1)),
      text: inline.content,
      id: slugify(inline.content),
    });
  }
  return out;
}
