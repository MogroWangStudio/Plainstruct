/** 站点预览 URL -- site:// 自定义协议的平台差异封装 */
import type { Platform } from "@/ipc/types";

/** Windows WebView2 将自定义协议映射为 http://site.localhost/,macOS 为 site://localhost/ */
export function protocolBase(platform: Platform): string {
  return platform === "macos" ? "site://localhost/" : "http://site.localhost/";
}

/** 站点根内相对路径 -> 可访问 URL(用于构建预览与编辑器预览里的资源) */
export function siteUrl(platform: Platform, relPath: string): string {
  return (
    protocolBase(platform) +
    relPath
      .split("/")
      .filter(Boolean)
      .map((s) => encodeURIComponent(s))
      .join("/")
  );
}

/** 构建产物入口页 */
export function buildIndexUrl(platform: Platform): string {
  return siteUrl(platform, "build/index.html");
}

/** 预览 iframe 内的页内锚点跳转。预览 iframe 的 sandbox 只保留同源、关闭其中脚本,
 *  主题自带的目录跳转脚本不会执行,由宿主代为滚动;标题的 scroll-margin-top
 *  仍生效,落点不会被吸顶顶栏遮住。返回是否命中目标。 */
export function scrollToAnchor(doc: Document, hash: string): boolean {
  let id = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    id = decodeURIComponent(id);
  } catch {
    /* 非 UTF-8 百分号序列时按原样查找 */
  }
  const target = id ? doc.getElementById(id) : null;
  if (!target) return false;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  return true;
}
