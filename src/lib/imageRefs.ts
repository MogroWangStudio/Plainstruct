/** 站点图片引用查找 -- 与渲染管线同一套路径换算,供资产页展示与重命名联动 */
import { decodeHref, splitHash } from "./markdown";
import { dirname, encodePath, joinPosix, relPosix } from "./paths";

export interface ImageRef {
  /** 引用方文档(content/ 相对) */
  docPath: string;
  /** 文档中出现的原始路径文本(替换引用时按原文匹配) */
  raw: string;
  /** 图片 alt 文本 */
  alt: string;
}

/** Markdown 图片语法:![alt](src "title") */
const MD_IMAGE = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
/** Markdown 链接语法:[text](target) —— 图片是其特例(前缀 !),换算时幂等 */
const MD_LINK = /\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
/** 内联 HTML 图片:<img src="..."> */
const HTML_IMAGE = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
/** front-matter 块(--- 包围的配置头) */
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/;
/** 配置头中的封面图行 */
const COVER_LINE = /^cover:\s*(.+)$/m;

/** front-matter 中声明的封面图写法(原样,相对本文档路径或外链) */
function coverRefsOf(content: string): string[] {
  const fm = content.match(FRONT_MATTER);
  if (!fm) return [];
  const cover = fm[1].match(COVER_LINE)?.[1]?.trim().replace(/^["']|["']$/g, "");
  return cover ? [cover] : [];
}

/** 站点图片的统一标识(content/ 相对路径)是否被某文档引用的路径写法命中 */
function resolveRef(docPath: string, raw: string): string | null {
  if (/^(https?:|data:)/i.test(raw)) return null;
  const target = splitHash(raw)[0];
  if (!target) return null;
  const resolved = joinPosix(dirname(docPath), decodeHref(target));
  if (resolved.startsWith("..")) return null;
  return resolved;
}

/** 在全部文档中查找引用指定图片的位置(md 图片语法与内联 <img>),按文档与原文写法去重 */
export function findImageRefs(
  imagePath: string,
  docPaths: string[],
  docs: Record<string, string>,
): ImageRef[] {
  const refs: ImageRef[] = [];
  const seen = new Set<string>();
  for (const docPath of docPaths) {
    const content = docs[docPath];
    if (content === undefined) continue;
    const push = (raw: string, alt: string) => {
      if (resolveRef(docPath, raw) !== imagePath) return;
      const key = `${docPath}\n${raw}`;
      if (seen.has(key)) return;
      seen.add(key);
      refs.push({ docPath, raw, alt });
    };
    for (const m of content.matchAll(MD_IMAGE)) push(m[2], m[1]);
    for (const m of content.matchAll(HTML_IMAGE)) push(m[1], "");
    for (const raw of coverRefsOf(content)) push(raw, "cover");
  }
  return refs;
}

/** 文档内容中把图片的旧引用写法替换为新文件名(仅换最后一段,保持目录前缀形式) */
export function replaceImageRefs(content: string, refs: ImageRef[], newName: string): string {
  let out = content;
  for (const { raw } of refs) {
    const i = raw.lastIndexOf("/");
    const newRaw = (i === -1 ? "" : raw.slice(0, i + 1)) + encodeURIComponent(newName);
    if (newRaw !== raw) out = out.split(raw).join(newRaw);
  }
  return out;
}

/** 文档内容中把图片引用整体改写到新的 content/ 相对路径(跨目录移动用):
 *  与渲染管线同一换算 —— 新写法 = 新路径相对引用方文档目录,逐段 URL 编码 */
export function moveImageRefs(
  content: string,
  refs: ImageRef[],
  newPath: string,
  docPath: string,
): string {
  let out = content;
  const newRaw = encodePath(relPosix(dirname(docPath), newPath));
  for (const { raw } of refs) {
    if (newRaw !== raw) out = out.split(raw).join(newRaw);
  }
  return out;
}

/** 文档自身移动/重命名目录后,把文内的相对引用换算到新位置:
 *  覆盖 Markdown 图片、内联 <img>、front-matter 封面图与站内链接
 *  (它们都以「相对本文档目录」解析,文档挪了目录写法必须跟着换算)。
 *  外链/data:/锚点跳过;换算与渲染管线同一套 relPosix。 */
export function remapDocRefsForMove(oldPath: string, newPath: string, content: string): string {
  const oldDir = dirname(oldPath);
  const newDir = dirname(newPath);
  if (oldDir === newDir) return content;
  const remap = (raw: string): string => {
    if (/^(https?:|data:|mailto:|#)/i.test(raw)) return raw;
    const target = splitHash(raw)[0];
    if (!target) return raw;
    const resolved = joinPosix(oldDir, decodeHref(target));
    if (resolved.startsWith("..")) return raw; // 出根的写法保持原样
    return encodePath(relPosix(newDir, resolved)) + raw.slice(target.length);
  };
  let out = content;
  for (const m of content.matchAll(MD_IMAGE)) {
    const next = remap(m[2]);
    if (next !== m[2]) out = out.split(m[2]).join(next);
  }
  for (const m of content.matchAll(HTML_IMAGE)) {
    const next = remap(m[1]);
    if (next !== m[1]) out = out.split(m[1]).join(next);
  }
  const cover = coverRefsOf(content)[0];
  if (cover) {
    const next = remap(cover);
    if (next !== cover) out = out.split(cover).join(next);
  }
  // 站内 md 链接(不含图片;图片上方已换算):[text](target) 的 target 非锚点/外链时换算
  for (const m of content.matchAll(MD_LINK)) {
    const next = remap(m[2]);
    if (next !== m[2]) out = out.split(m[2]).join(next);
  }
  return out;
}

/** 引用计数:图片路径 -> 引用该图片的文档数(用于资产列表徽标) */
export function countImageRefs(
  imagePaths: string[],
  docPaths: string[],
  docs: Record<string, string>,
): Map<string, number> {
  const counts = new Map<string, number>(imagePaths.map((p) => [p, 0]));
  for (const docPath of docPaths) {
    const content = docs[docPath];
    if (content === undefined) continue;
    const hit = (raw: string) => {
      const resolved = resolveRef(docPath, raw);
      if (resolved && counts.has(resolved)) counts.set(resolved, (counts.get(resolved) ?? 0) + 1);
    };
    for (const m of content.matchAll(MD_IMAGE)) hit(m[2]);
    for (const m of content.matchAll(HTML_IMAGE)) hit(m[1]);
    for (const raw of coverRefsOf(content)) hit(raw);
  }
  return counts;
}
