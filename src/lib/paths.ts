/** 站内路径工具 -- 一律 POSIX 风格("/" 分隔,相对 content/ 或 build/) */

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

export function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

/** 是否为图片文件(资产页与内容树共用同一判定) */
export function isImageFile(p: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(p);
}

/** 资产导入拒绝的可执行扩展名:静态站资产只做展示与下载,不收可执行内容 */
const ASSET_IMPORT_BLOCKLIST = /\.(exe|dll|bat|cmd|com|msi|scr|ps1|app|jar|sh)$/i;

/** 是否为可导入资产页的文件(不限于图片;仅拒绝可执行类) */
export function isImportableAsset(p: string): boolean {
  return !ASSET_IMPORT_BLOCKLIST.test(p);
}

/** 站点资产目录名(新建站点用 asset,旧站点的 images 仍兼容识别) */
export const ASSET_DIR = "asset";

/** 资产拖拽数据类型:拖入编辑器时按此取图片路径 */
export const ASSET_MIME = "application/x-plainstruct-asset";

/** 目录名是否为站点资产目录(asset 与旧版 images 均算) */
export function isAssetDirName(name: string): boolean {
  const n = name.toLowerCase();
  return n === ASSET_DIR || n === "images";
}

/** 从文档位置引用站点资产的路径前缀(根级文档 asset/…,子目录 ../asset/…) */
export function assetRefPrefix(depth: number): string {
  return "../".repeat(depth) + ASSET_DIR + "/";
}

export function stripExt(p: string): string {
  const i = p.lastIndexOf(".");
  return i <= p.lastIndexOf("/") ? p : p.slice(0, i);
}

export function joinPosix(...parts: string[]): string {
  const merged = parts.filter(Boolean).join("/");
  const segs: string[] = [];
  for (const seg of merged.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (segs.length > 0 && segs[segs.length - 1] !== "..") segs.pop();
      else segs.push("..");
      continue;
    }
    segs.push(seg);
  }
  return segs.join("/");
}

/** 从 fromDir 目录出发指向 to 的相对路径 */
export function relPosix(fromDir: string, to: string): string {
  const from = fromDir ? fromDir.split("/") : [];
  const toSegs = to.split("/");
  let i = 0;
  while (i < from.length && i < toSegs.length - 1 && from[i] === toSegs[i]) i++;
  const up = from.length - i;
  return [...Array(up).fill(".."), ...toSegs.slice(i)].join("/") || toSegs[toSegs.length - 1];
}

/** URL 编码单个路径,保留 "/" */
export function encodePath(p: string): string {
  return p
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
}

/**
 * content/ 内的 md 路径 -> build/ 内的 html 路径。
 * index.md 语义:目录的落点页。
 *   index.md        -> index.html
 *   foo.md          -> foo.html
 *   foo/index.md    -> foo/index.html
 *   foo/bar.md      -> foo/bar.html
 */
export function mdToHtml(mdPath: string): string {
  const lower = mdPath.toLowerCase();
  if (lower === "index.md") return "index.html";
  if (lower.endsWith("/index.md")) {
    return mdPath.slice(0, -"index.md".length) + "index.html";
  }
  return mdPath.replace(/\.md$/i, ".html");
}

/** 输出页面所在深度 -> 相对根前缀("a/b.html" -> "../") */
export function relPrefix(htmlPath: string): string {
  const depth = htmlPath.split("/").length - 1;
  return depth === 0 ? "" : "../".repeat(depth);
}

export function isMarkdown(path: string): boolean {
  return /\.md$/i.test(path);
}

/** 文件名可安全作为磁盘名(去掉 Windows 非法字符与控制符) */
export function safeName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim();
  return cleaned || "untitled";
}
