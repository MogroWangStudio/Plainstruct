/** 构建管线 -- 读树 -> 渲染 Markdown -> 套主题 -> 写出 build/;
 *  renderPreview 与构建共用同一套解析,保证「预览即产出」。 */
import { ipc } from "@/ipc/ipc";
import type { BuildReport, BuildWarning, CopyItem, OutputFile, Platform, SiteConfig, SitePluginFiles, SiteType, TreeNode } from "@/ipc/types";
import { parseFrontMatter } from "./frontmatter";
import { renderMarkdown, decodeHref, splitHash, extractHeadings, type MdEnv } from "./markdown";
import { basename, dirname, encodePath, isMarkdown, isAssetDirName, joinPosix, mdToHtml, relPosix, relPrefix, stripExt } from "./paths";
import { compileTheme, mergeConfigDefaults, type ArchiveYear, type NavItem, type PageContext, type PaginationInfo, type PostGroup, type PostSummary, type ThemeBundle } from "./theme-engine";
import { siteUrl } from "./preview";
import {
  builtinPluginOutputs,
  htmlToText,
  injectPluginTags,
  inlinePreviewPlugins,
  mdToText,
  normalizePlugins,
  pluginCopyItems,
  pluginTags,
  searchIndexTag,
  type SearchPage,
} from "./plugins";
import psBlogJs from "@/plugins/ps-blog.js?raw";
import psBlogCss from "@/plugins/ps-blog.css?raw";

/** 站点行为运行时:head 引导(ps-js,首帧前标记 JS 可用)+ 共享功能样式
 *  (ps-blog:归档页/文件夹页/分类分组/封面比例 —— 注入到主题样式链接之前,
 *  让主题自身的同名规则仍可覆盖)+ body 末尾行为脚本。
 *  组页时注入而非写死在主题模板:构建产物与预览同源生效,自定义主题的
 *  旧模板/旧样式快照同样获得最新行为与样式。 */
const PS_BOOT_TAG = '<script>document.documentElement.classList.add("ps-js");</script>\n';
const PS_STYLE_TAG = `<style id="ps-blog-css">\n${psBlogCss}\n</style>\n`;
const PS_BEHAVIOR_TAG = `<script>\n${psBlogJs}\n</script>\n`;

function injectSiteBehavior(html: string): string {
  let out = html;
  // 共享样式插到主题样式链接之前(保证主题自定义可覆盖);
  // mock 预览的内联化发生在注入之后,顺序保持不变
  const link = out.search(/<link\b/i);
  if (link >= 0) out = out.slice(0, link) + PS_STYLE_TAG + out.slice(link);
  const headEnd = out.lastIndexOf("</head>");
  if (headEnd >= 0) out = out.slice(0, headEnd) + PS_BOOT_TAG + out.slice(headEnd);
  else out = PS_BOOT_TAG + out;
  const bodyEnd = out.lastIndexOf("</body>");
  if (bodyEnd >= 0) out = out.slice(0, bodyEnd) + PS_BEHAVIOR_TAG + out.slice(bodyEnd);
  else out += PS_BEHAVIOR_TAG;
  return out;
}

export interface DocMeta {
  path: string;
  title: string;
  order: number;
  description?: string;
  date?: string;
  /** 封面图:文档中的原始写法(相对本文档路径或外链 URL) */
  cover?: string;
  /** 作者署名(配置头 author,缺省不显示) */
  author?: string;
  /** AIGC 声明(配置头 aigc: none/present;缺省不显示) */
  aigc?: string;
  /** 隐藏文档:不进文章流/导航/搜索索引,页面仍生成(仅可通过链接访问) */
  hidden?: boolean;
  /** 博客主页(根 index.md)专属:卡片流按分类分组 */
  homeGroups?: boolean;
  /** 博客主页专属:分组时显示「未分类」组(根级文章);缺省显示,false = 隐藏 */
  homeUncategorized?: boolean;
  /** 博客主页专属:「未分类」组的自定义标题 */
  homeUncategorizedLabel?: string;
  body: string;
}

interface RawNav {
  title: string;
  htmlPath?: string;
  children: RawNav[];
  /** 文件夹项(配置面板的顶栏导航选择列表据此区分) */
  dir?: boolean;
  /** 隐藏文档:不进侧栏导航/目录页/上一下一篇,顶栏自定义导航仍可选用 */
  hidden?: boolean;
}

export type DocsCache = Record<string, string>;

export function walkTree(nodes: TreeNode[], fn: (node: TreeNode) => void) {
  for (const n of nodes) {
    fn(n);
    if (n.children?.length) walkTree(n.children, fn);
  }
}

/** 收集全部 md 文档路径(content/ 相对) */
export function collectDocPaths(tree: TreeNode[]): string[] {
  const paths: string[] = [];
  walkTree(tree, (n) => {
    if (n.type === "file" && isMarkdown(n.path)) paths.push(n.path);
  });
  return paths;
}

/** 正文与 front-matter 标题重复时去掉正文首个标题,避免页面出现双标题 */
function stripLeadingTitle(body: string, title: string): string {
  const m = body.match(/^#\s+(.+?)\s*$/m);
  if (!m) return body;
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  if (norm(m[1]) === norm(title)) {
    return body.replace(/^#\s+.+?\s*$/m, "").replace(/^\s+/, "");
  }
  return body;
}

function buildMetas(paths: string[], cache: DocsCache): Map<string, DocMeta> {
  const metas = new Map<string, DocMeta>();
  for (const path of paths) {
    const { data, body } = parseFrontMatter(cache[path] ?? "");
    const title = data.title ?? stripExt(basename(path));
    metas.set(path, {
      path,
      title,
      order: data.order ?? 0,
      description: data.description,
      date: data.date,
      cover: data.cover,
      author: data.author,
      aigc: data.aigc,
      hidden: data.hidden === true,
      homeGroups: data.homeGroups === true,
      homeUncategorized: data.homeUncategorized === false ? false : undefined,
      homeUncategorizedLabel: data.homeUncategorizedLabel,
      body: stripLeadingTitle(body, title),
    });
  }
  return metas;
}

/** 是否位于站点资产子树内(asset,兼容旧 images):任意层级命中即整棵排除,
 *  只作为资源,不进入导航与目录页 */
export function isAssetDir(path: string): boolean {
  return path.split("/").some(isAssetDirName);
}

/** 封面图统一为 content/ 相对路径(外链 URL 原样保留),供文章流与预览换算页面地址 */
function coverOf(meta: DocMeta): string | undefined {
  const raw = meta.cover?.trim();
  if (!raw) return undefined;
  if (/^(https?:|data:)/i.test(raw)) return raw;
  return joinPosix(dirname(meta.path), decodeHref(splitHash(raw)[0]));
}

/** 日期排序键:解析 Y-M-D 为可比较元组;非日期文本回退字符串比较。
 *  front-matter 的 date 原样保留,不保证零填充,字符串比较会把 2026-9-1 排到 2026-10-1 之后 */
function dateKey(date: string): { y: number; m: number; d: number; raw: string } {
  const g = date.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return g ? { y: +g[1], m: +g[2], d: +g[3], raw: "" } : { y: 0, m: 0, d: 0, raw: date };
}

/** 博客文章流:排除各级 index.md,有 date 的按日期倒序在前,无 date 的按标题排在后 */
function buildPosts(metas: Map<string, DocMeta>): PostSummary[] {
  const posts = [...metas.values()]
    .filter((m) => !m.hidden && basename(m.path).toLowerCase() !== "index.md")
    .map((m) => ({
      title: m.title,
      htmlPath: mdToHtml(m.path),
      date: m.date,
      description: m.description,
      cover: coverOf(m),
    }));
  const withDate = posts
    .filter((p) => p.date)
    .sort((a, b) => {
      const ka = dateKey(a.date!);
      const kb = dateKey(b.date!);
      if (ka.y !== kb.y) return kb.y - ka.y;
      if (ka.m !== kb.m) return kb.m - ka.m;
      if (ka.d !== kb.d) return kb.d - ka.d;
      return kb.raw < ka.raw ? -1 : kb.raw > ka.raw ? 1 : 0;
    });
  const withoutDate = posts
    .filter((p) => !p.date)
    .sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
  return [...withDate, ...withoutDate];
}

function buildNav(nodes: TreeNode[], metas: Map<string, DocMeta>): RawNav[] {
  const result: RawNav[] = [];
  for (const node of nodes) {
    if (node.type === "dir") {
      // asset(及旧 images)是资产目录,不进入站点导航,也不生成目录页
      if (isAssetDir(node.path)) continue;
      const indexChild = (node.children ?? []).find(
        (c) => c.type === "file" && c.name.toLowerCase() === "index.md",
      );
      const children = buildNav(
        (node.children ?? []).filter((c) => c !== indexChild),
        metas,
      );
      const indexMeta = indexChild ? metas.get(indexChild.path) : undefined;
      result.push({
        title: indexMeta?.title ?? node.name,
        // 有 index.md 用其页面;没有则指向自动生成的文件夹页(dir/index.html)
        htmlPath: indexChild
          ? mdToHtml(indexChild.path)
          : mdToHtml(node.path ? `${node.path}/index.md` : "index.md"),
        children,
        dir: true,
        // 落地页被隐藏时,文件夹入口同样从侧栏/目录页隐去
        hidden: indexMeta?.hidden === true || undefined,
      });
    } else if (isMarkdown(node.path) && node.path.toLowerCase() !== "index.md") {
      // 根级 index.md 即站点首页(站点名入口),不重复出现在导航
      const meta = metas.get(node.path);
      result.push({
        title: meta?.title ?? stripExt(node.name),
        htmlPath: mdToHtml(node.path),
        children: [],
        hidden: meta?.hidden === true || undefined,
      });
    }
  }
  return result;
}

function navForPage(raw: RawNav[], currentHtml: string, outDir: string): NavItem[] {
  return raw.map((item) => ({
    title: item.title,
    url: item.htmlPath ? encodePath(relPosix(outDir, item.htmlPath)) : undefined,
    current: item.htmlPath === currentHtml,
    children: item.children.length ? navForPage(item.children, currentHtml, outDir) : undefined,
  }));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** 自动目录页的 TOC HTML -- 站点首页与文件夹页共用(该目录没有 index.md 时) */
function tocHtml(raw: RawNav[], fromDir: string): string {
  // 目录列表页不展示隐藏文档(仍可通过直接链接访问)
  const items = (list: RawNav[]): string =>
    list.filter((item) => !item.hidden).length
      ? `<ul class="ps-home-list">${list
          .filter((item) => !item.hidden)
          .map((item) => {
            const head = item.htmlPath
              ? `<a class="ps-home-link" href="${encodePath(relPosix(fromDir, item.htmlPath))}">${escapeHtml(item.title)}</a>`
              : `<span class="ps-home-link">${escapeHtml(item.title)}</span>`;
            return `<li class="ps-home-item">${head}${items(item.children)}</li>`;
          })
          .join("")}</ul>`
      : "";
  return items(raw);
}

function flattenNav(raw: RawNav[]): RawNav[] {
  const out: RawNav[] = [];
  for (const item of raw) {
    if (item.htmlPath) out.push(item);
    out.push(...flattenNav(item.children));
  }
  return out;
}

/** 文档站侧栏导航:递归剔除隐藏文档(顶栏自定义导航不走这里,可保留勾选的隐藏文档) */
function navForSidebar(raw: RawNav[]): RawNav[] {
  return raw
    .filter((item) => !item.hidden)
    .map((item) => (item.children.length ? { ...item, children: navForSidebar(item.children) } : item));
}

/** 浏览器标签页标题:按站点 titleFormat 拼接 {page}/{site},首页只显示站点名 */
function pageTitle(site: SiteConfig, docTitle: string): string {
  if (docTitle === site.name) return site.name;
  const fmt = (site.titleFormat ?? "").trim() || "{page} · {site}";
  if (!fmt.includes("{page}")) return site.name;
  return fmt.replace(/\{page\}/g, docTitle).replace(/\{site\}/g, site.name);
}

/** 当前页在导航中的面包屑(不含页面自身),用于移动端顶栏 */
function crumbsFor(raw: RawNav[], currentHtml: string): string[] {
  const walk = (items: RawNav[], trail: string[]): string[] | null => {
    for (const item of items) {
      const next = [...trail, item.title];
      if (item.htmlPath === currentHtml) return next;
      const hit = item.children.length ? walk(item.children, next) : null;
      if (hit) return hit;
    }
    return null;
  };
  const chain = walk(raw, []);
  return chain ? chain.slice(0, -1) : [];
}

/** 博客首页分页参数(每页文章数来自主题配置,越界时收敛) */
export function postsPerPageOf(config: Record<string, string | number | boolean>): number {
  const n = Math.floor(Number(config.postsPerPage));
  return Number.isFinite(n) ? Math.min(50, Math.max(3, n)) : 10;
}

/** 博客顶栏导航数量上限的缺省值(上限可配 1–12,顶栏宽度有限,超出一律截断) */
export const BLOG_NAV_MAX_DEFAULT = 6;
const BLOG_NAV_MAX_CEIL = 12;

/** 右上角导航数量上限(主题配置 navMaxItems,越界时收敛) */
export function navMaxOf(config: Record<string, string | number | boolean>): number {
  const n = Math.floor(Number(config.navMaxItems));
  return Number.isFinite(n) ? Math.min(BLOG_NAV_MAX_CEIL, Math.max(1, n)) : BLOG_NAV_MAX_DEFAULT;
}

/**
 * 博客顶栏导航:navMode 为"自定义"时按选择(htmlPath 按行分隔)保留,顺序仍随内容树;
 * 可选池为整棵导航树(含文件夹内页面,选择器中展开后可选),不再限于顶层。
 * 选择为空或全部失效时回退为全部,避免导航意外消失。任何模式都受数量上限收敛。
 */
export function blogTopNav(config: Record<string, string | number | boolean>, raw: RawNav[]): RawNav[] {
  const picked = String(config.navPicked ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const custom = String(config.navMode ?? "") === "自定义" && picked.length;
  const chosen = custom
    ? // 自定义模式:按选择保留(隐藏文档被明确勾选时仍可展示在顶栏)
      flattenNav(raw).filter((item) => item.htmlPath !== undefined && picked.includes(item.htmlPath))
    : // 默认模式:隐去隐藏文档
      raw.filter((item) => !item.hidden);
  return chosen.slice(0, navMaxOf(config));
}

/** 导航选择器条目:与构建同源的导航树(文件夹内页面可在选择器中展开后勾选) */
export interface NavPickerItem {
  key: string;
  title: string;
  dir: boolean;
  children: NavPickerItem[];
}

/** 配置面板用:完整导航树(与构建同源),key 为 htmlPath(blogTopNav 按它匹配) */
export function topNavItems(tree: TreeNode[], cache: DocsCache): NavPickerItem[] {
  const metas = buildMetas(collectDocPaths(tree), cache);
  const conv = (items: RawNav[]): NavPickerItem[] =>
    items
      .filter((item) => item.htmlPath !== undefined)
      .map((item) => ({
        key: item.htmlPath!,
        title: item.title,
        dir: item.dir === true,
        children: conv(item.children),
      }));
  return conv(buildNav(tree, metas));
}

/** 博客主页 extras:主页配置头(homeGroups)驱动分类分组。
 *  分组模式整流展示不分页,常规模式按主题「每页文章数」切片分页 */
function blogHomeExtrasFor(
  siteType: SiteType,
  allPosts: PostSummary[],
  home: DocMeta | undefined,
  config: Record<string, string | number | boolean>,
  tree: TreeNode[],
  metas: Map<string, DocMeta>,
): BlogHomeExtras {
  if (siteType !== "blog") return { siteType };
  if (home?.homeGroups) {
    return { siteType, posts: allPosts, postGroups: buildPostGroups(tree, metas, allPosts, home) };
  }
  const perPage = postsPerPageOf(config);
  const total = Math.max(1, Math.ceil(allPosts.length / perPage));
  return { siteType, posts: allPosts.slice(0, perPage), pagination: { current: 1, total } };
}

/** 主页分类卡片流:顶层目录(导航树顺序)为一组,组名取目录 index.md 的标题或目录名,
 *  组内文章保持 posts 的既有排序(日期倒序)。根级文章归入「未分类」排最后 ——
 *  仅在主页配置允许显示时出现,组名可由主页配置自定义 */
function buildPostGroups(
  tree: TreeNode[],
  metas: Map<string, DocMeta>,
  posts: PostSummary[],
  home: DocMeta | undefined,
): PostGroup[] {
  const byPath = new Map(posts.map((p) => [p.htmlPath, p]));
  const used = new Set<string>();
  const groups: PostGroup[] = [];
  for (const node of tree) {
    if (node.type !== "dir" || isAssetDir(node.path)) continue;
    const indexChild = (node.children ?? []).find(
      (c) => c.type === "file" && c.name.toLowerCase() === "index.md",
    );
    const group: PostSummary[] = [];
    const collect = (n: TreeNode) => {
      if (n.type === "file" && isMarkdown(n.path)) {
        const p = byPath.get(mdToHtml(n.path));
        if (p) {
          group.push(p);
          used.add(p.htmlPath);
        }
      }
      for (const c of n.children ?? []) collect(c);
    };
    for (const c of node.children ?? []) collect(c);
    if (group.length) {
      groups.push({
        title: (indexChild ? metas.get(indexChild.path)?.title : undefined) ?? node.name,
        url: mdToHtml(indexChild ? indexChild.path : `${node.path}/index.md`),
        posts: group,
      });
    }
  }
  const showUncategorized = home?.homeUncategorized !== false;
  if (showUncategorized) {
    const rest = posts.filter((p) => !used.has(p.htmlPath));
    if (rest.length) {
      groups.push({ title: home?.homeUncategorizedLabel?.trim() || "未分类", posts: rest });
    }
  }
  return groups;
}

/** 文章的 content/ 相对路径映射(htmlPath → md path),供按目录过滤文章流 */
function htmlToMdMap(metas: Map<string, DocMeta>): Map<string, string> {
  return new Map([...metas.values()].map((m) => [mdToHtml(m.path), m.path]));
}

/** 某目录(递归)内的文章,保持 allPosts 的既有排序(日期倒序) */
function postsInDir(allPosts: PostSummary[], htmlToMd: Map<string, string>, dir: string): PostSummary[] {
  const prefix = dir ? `${dir}/` : "";
  return allPosts.filter((p) => {
    const md = htmlToMd.get(p.htmlPath);
    return md !== undefined && md.startsWith(prefix);
  });
}

/** 归档列表视图:按年份分组(年份倒序,无日期组排最后,year 为空串) */
function buildArchiveYears(posts: PostSummary[]): ArchiveYear[] {
  const byYear = new Map<string, PostSummary[]>();
  for (const p of posts) {
    const year = p.date?.trim().match(/^(\d{4})/)?.[1] ?? "";
    const bucket = byYear.get(year);
    if (bucket) bucket.push(p);
    else byYear.set(year, [p]);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => (a && b ? b.localeCompare(a) : a ? -1 : 1))
    .map(([year, items]) => ({ year, posts: items }));
}

/** 博客落地页系列页的渲染数据:文章切片/分类分组/文件夹卡片流 + 分页信息
 *  (url 由 renderOnePage 按页深换算) */
interface BlogHomeExtras {
  siteType: SiteType;
  posts?: PostSummary[];
  pagination?: { current: number; total: number };
  /** 主页配置头 homeGroups 开启时按分类分组展示(此时不分页) */
  postGroups?: PostGroup[];
  /** 博客文件夹落地页的卡片流视图(该目录递归内的文章;缺省视图) */
  folderPosts?: PostSummary[];
  /** 博客归档页:全部文章的三种视图数据(列表/分类/卡片流) */
  archive?: { posts: PostSummary[]; groups: PostGroup[]; years: ArchiveYear[] };
}

/** 渲染单页(构建与预览共用)。warnings 为空数组时收集,预览可忽略。 */
function renderOnePage(
  site: SiteConfig,
  config: Record<string, string | number | boolean>,
  render: ReturnType<typeof compileTheme>,
  navRaw: RawNav[],
  docMap: Map<string, string>,
  dirSet: Set<string>,
  doc: DocMeta,
  warnings: BuildWarning[],
  resolveAsset?: MdEnv["resolveAsset"],
  /** 预览模式:logo / favicon 的绝对地址(构建时留空,使用相对路径) */
  siteImages?: { logo?: string; favicon?: string },
  /** 预览模式:文章封面的绝对地址(构建时留空,使用相对路径) */
  coverUrl?: (cover: string) => string,
  /** 站点类型与博客文章流(extras.posts 为当前页应展示的切片,extras.pagination 仅首页系列传入) */
  extras?: BlogHomeExtras,
): PageContext & { html: string } {
  const htmlPath = mdToHtml(doc.path);
  const outDir = dirname(htmlPath);
  const prefix = relPrefix(htmlPath);
  // 上/下篇沿导航顺序但跳过隐藏文档;文档站侧栏同样隐去隐藏文档
  // (博客顶栏由 blogTopNav 决定,自定义勾选的隐藏文档仍可展示)
  const flat = flattenNav(navRaw).filter((n) => !n.hidden);
  const idx = flat.findIndex((n) => n.htmlPath === htmlPath);
  const prev = idx > 0 ? flat[idx - 1] : undefined;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : undefined;
  const isBlog = (extras?.siteType ?? "docs") === "blog";
  const pag = extras?.pagination;

  // 图片等资源按当前文档目录解析;分页伪页(page/N)的公告正文来自根 index.md,按根目录解析。
  // 构建时把资源统一改写为页面相对地址(预览由调用方传入 siteUrl 版本),深层页面与分页页同样正确。
  const env: MdEnv = {
    currentMdPath: pag ? "index.md" : doc.path,
    docMap,
    dirSet,
    warnings,
    resolveAsset: resolveAsset ?? ((resolved) => encodePath(relPosix(outDir, resolved))),
  };
  const content = renderMarkdown(doc.body, env);

  // 分页页码链接:统一指向目录内 index.html,由 relPosix 换算为当前页相对地址
  let pagination: PaginationInfo | undefined;
  if (pag) {
    const pageUrl = (n: number) => encodePath(relPosix(outDir, n === 1 ? "index.html" : `page/${n}/index.html`));
    const pages = Array.from({ length: pag.total }, (_, i) => {
      const n = i + 1;
      return { n, url: pageUrl(n), current: n === pag.current };
    });
    pagination = {
      current: pag.current,
      total: pag.total,
      pages,
      prevUrl: pag.current > 1 ? pageUrl(pag.current - 1) : undefined,
      nextUrl: pag.current < pag.total ? pageUrl(pag.current + 1) : undefined,
    };
  }

  const cfgLogo = site.logo;
  // 站点外图标未单独设置时沿用站点内 logo(旧站点行为不变)
  const cfgFavicon = site.favicon || site.logo;
  // 文章流条目统一换算:htmlPath/封面 → 当前页相对地址(预览封面为绝对协议地址)
  const mapPost = (p: PostSummary) => ({
    ...p,
    url: encodePath(relPosix(outDir, p.htmlPath)),
    cover: p.cover
      ? /^(https?:|data:)/i.test(p.cover)
        ? p.cover
        : (coverUrl?.(p.cover) ?? encodePath(relPosix(outDir, p.cover)))
      : undefined,
  });
  const ctx: PageContext = {
    site: {
      name: site.name,
      description: site.description,
      logo: siteImages?.logo ?? (cfgLogo ? prefix + "assets/" + encodePath(cfgLogo) : undefined),
      favicon: siteImages?.favicon ?? (cfgFavicon ? prefix + "assets/" + encodePath(cfgFavicon) : undefined),
      locale: site.locale || "zh-CN",
    },
    page: {
      title: doc.title,
      description: doc.description,
      content,
      path: doc.path,
      url: htmlPath,
      relPrefix: prefix,
      fullTitle: pageTitle(site, doc.title),
      crumbs: crumbsFor(navRaw, htmlPath),
      date: doc.date,
      author: doc.author,
      aigc: doc.aigc,
      // 博客首页系列(含 page/N)由模板渲染文章流
      isHome: htmlPath === "index.html" || !!pagination || undefined,
      // 博客文章页的页内目录;标题 id 与渲染管线同源(extractHeadings 复用 slugify),锚点一致
      toc: isBlog && !pagination ? extractHeadings(doc.body) : undefined,
      pagination,
      // 主页分类卡片流(主页配置头 homeGroups;组内条目与文章流同规则换算)
      postGroups: isBlog
        ? extras?.postGroups?.map((g) => ({
            title: g.title,
            url: g.url ? encodePath(relPosix(outDir, g.url)) : undefined,
            posts: g.posts.map(mapPost),
          }))
        : undefined,
      // 博客文件夹落地页的卡片流视图(该目录递归内的文章)
      folderPosts: isBlog ? extras?.folderPosts?.map(mapPost) : undefined,
      // 归档页:三种视图的数据全部按页深换算
      isArchive: !!extras?.archive || undefined,
      archive: extras?.archive
        ? {
            posts: extras.archive.posts.map(mapPost),
            groups: extras.archive.groups.map((g) => ({
              title: g.title,
              url: g.url ? encodePath(relPosix(outDir, g.url)) : undefined,
              posts: g.posts.map(mapPost),
            })),
            years: extras.archive.years.map((y) => ({ year: y.year, posts: y.posts.map(mapPost) })),
          }
        : undefined,
    },
    // 博客顶栏按主题配置裁剪(自定义选择 + 数量上限);文档站侧栏隐去隐藏文档;
    // 上/下篇与面包屑仍按完整导航树计算
    nav: navForPage(isBlog ? blogTopNav(config, navRaw) : navForSidebar(navRaw), htmlPath, outDir),
    prev: prev ? { title: prev.title, url: encodePath(relPosix(outDir, prev.htmlPath!)) } : undefined,
    next: next ? { title: next.title, url: encodePath(relPosix(outDir, next.htmlPath!)) } : undefined,
    posts: isBlog ? extras?.posts?.map(mapPost) : undefined,
    config,
  };
  return { ...ctx, html: injectSiteBehavior(render(ctx)) };
}

/**
 * 预览专用:把主题的 link/script 资源内联进 HTML。
 * 预览 iframe 以 document.write 写入,相对资源地址会指向应用自身 origin,必须内联。
 */
function inlineThemeAssets(html: string, files: Record<string, string>): string {
  return html
    .replace(/<link\b[^>]*href="([^"]+)"[^>]*>/gi, (m, href: string) => {
      const clean = href.replace(/^(\.\.\/)+/, "");
      const content = files[clean] ?? files["assets/" + clean];
      return content !== undefined ? `<style>\n${content}\n</style>` : m;
    })
    .replace(/<script\b[^>]*src="([^"]+)"[^>]*>\s*<\/script>/gi, (m, src: string) => {
      const clean = src.replace(/^(\.\.\/)+/, "");
      const content = files[clean] ?? files["assets/" + clean];
      return content !== undefined ? `<script>\n${content}\n</script>` : m;
    });
}

/** 单页预览:完整布局渲染当前文档(编辑器内容即时覆盖) */
export function renderPreview(
  site: SiteConfig,
  theme: ThemeBundle,
  tree: TreeNode[],
  cache: DocsCache,
  currentPath: string,
  currentBody: string | undefined,
  platform: Platform,
  /** 用户插件的文件内容(站点打开时预载,预览通道内联注入) */
  pluginContents: SitePluginFiles[] = [],
  /** 「刷新时禁用动画」:mock 预览的页面加载不重播进场/加载动画(Tauri 产物由注入 shim 负责) */
  suppressAnim = false,
): string {
  const paths = collectDocPaths(tree);
  const docCache = { ...cache };
  if (currentBody !== undefined) docCache[currentPath] = currentBody;
  const metas = buildMetas(paths, docCache);

  const docMap = new Map<string, string>();
  const dirSet = new Set<string>();
  walkTree(tree, (n) => {
    if (n.type === "dir") dirSet.add(n.path.toLowerCase());
  });
  for (const p of paths) docMap.set(p.toLowerCase(), p);

  const config = mergeConfigDefaults(theme.meta, site.theme.config);
  const render = compileTheme(theme);
  const navRaw = buildNav(tree, metas);
  const doc = metas.get(currentPath);
  if (!doc) return "";
  const siteType = site.siteType ?? "docs";
  // 博客根 index 预览第 1 页文章流(按主页配置头裁剪);其余文档页不带分页数据
  let extras: BlogHomeExtras = { siteType };
  if (siteType === "blog" && currentPath.toLowerCase() === "index.md") {
    extras = blogHomeExtrasFor(siteType, buildPosts(metas), metas.get(currentPath), config, tree, metas);
  }
  const logoUrl = site.logo
    ? siteUrl(platform, `.plainstruct/assets/${site.logo}`)
    : undefined;
  const faviconName = site.favicon || site.logo;
  const faviconUrl = faviconName
    ? siteUrl(platform, `.plainstruct/assets/${faviconName}`)
    : undefined;
  const { html } = renderOnePage(
    site,
    config,
    render,
    navRaw,
    docMap,
    dirSet,
    doc,
    [],
    (resolved) => siteUrl(platform, "content/" + resolved),
    { logo: logoUrl, favicon: faviconUrl },
    (cover) => siteUrl(platform, "content/" + cover),
    extras,
  );
  // 先内联主题资产,再追加插件:搜索数据内联在前,脚本在主题脚本之后执行
  let out = inlineThemeAssets(html, theme.files);
  const pluginTags = inlinePreviewPlugins(site, pluginContents);
  if (pluginTags.length) {
    const search = normalizePlugins(site).search ? [searchIndexTag(previewSearchPages(metas, tree))] : [];
    out = injectPluginTags(out, [...search, ...pluginTags]);
  }
  if (suppressAnim) out = suppressPageAnimTag(out);
  return out;
}

/**
 * 预览专用:渲染构建产物中才存在的页面 —— 博客归档页与文件夹落地页。
 * 编辑器预览点击对应链接时由 DocPreview 调用,渲染管线与产物同源。
 * 文件夹页显示方式按 folders.json(读取失败回退缺省卡片流);
 * 文档站点的目录落地页以目录列表正文呈现。
 */
export async function renderSpecialPreview(
  site: SiteConfig,
  theme: ThemeBundle,
  tree: TreeNode[],
  cache: DocsCache,
  target: { type: "archive" } | { type: "folder"; dir: string },
  platform: Platform,
  pluginContents: SitePluginFiles[] = [],
  suppressAnim = false,
): Promise<string> {
  const paths = collectDocPaths(tree);
  const metas = buildMetas(paths, cache);
  const siteType = site.siteType ?? "docs";
  const config = mergeConfigDefaults(theme.meta, site.theme.config);
  const render = compileTheme(theme);
  const navRaw = buildNav(tree, metas);
  const docMap = new Map<string, string>();
  const dirSet = new Set<string>();
  walkTree(tree, (n) => {
    if (n.type === "dir") dirSet.add(n.path.toLowerCase());
  });
  for (const p of paths) docMap.set(p.toLowerCase(), p);

  const rootIndex = paths.find((p) => p.toLowerCase() === "index.md");
  const homeDoc = rootIndex ? metas.get(rootIndex) : undefined;
  const allPosts = siteType === "blog" ? buildPosts(metas) : [];

  let page: DocMeta;
  let extras: BlogHomeExtras;
  if (target.type === "archive" && siteType === "blog") {
    page = { path: "archive/index.md", title: "归档", order: 0, body: "" };
    extras = {
      siteType,
      archive: {
        posts: allPosts,
        groups: buildPostGroups(tree, metas, allPosts, homeDoc),
        years: buildArchiveYears(allPosts),
      },
    };
  } else {
    const dir = target.type === "folder" ? target.dir : "";
    let view = "stream";
    if (siteType === "blog") {
      try {
        view = (await ipc.readFolderConfigs())[dir]?.view ?? "stream";
      } catch {
        /* 读取失败回退缺省卡片流 */
      }
    } else {
      view = "list";
    }
    const node = findDirNode(tree, dir);
    const children = node?.children ?? [];
    const asList = siteType !== "blog" || view === "list";
    page = {
      path: `${dir}/index.md`,
      title: node?.name ?? dir,
      order: 0,
      body: asList ? tocHtml(buildNav(children, metas), dir) : "",
    };
    extras =
      siteType === "blog" && !asList
        ? { siteType, folderPosts: postsInDir(allPosts, htmlToMdMap(metas), dir) }
        : { siteType };
  }

  const logoUrl = site.logo ? siteUrl(platform, `.plainstruct/assets/${site.logo}`) : undefined;
  const faviconName = site.favicon || site.logo;
  const faviconUrl = faviconName ? siteUrl(platform, `.plainstruct/assets/${faviconName}`) : undefined;
  const { html } = renderOnePage(
    site,
    config,
    render,
    navRaw,
    docMap,
    dirSet,
    page,
    [],
    (resolved) => siteUrl(platform, "content/" + resolved),
    { logo: logoUrl, favicon: faviconUrl },
    (cover) => siteUrl(platform, "content/" + cover),
    extras,
  );
  let out = inlineThemeAssets(html, theme.files);
  const tags = inlinePreviewPlugins(site, pluginContents);
  if (tags.length) {
    const search = normalizePlugins(site).search ? [searchIndexTag(previewSearchPages(metas, tree))] : [];
    out = injectPluginTags(out, [...search, ...tags]);
  }
  if (suppressAnim) out = suppressPageAnimTag(out);
  return out;
}

/** 在内容树中查找目录节点(content/ 相对路径) */
function findDirNode(tree: TreeNode[], dir: string): TreeNode | undefined {
  if (!dir) return undefined;
  for (const n of tree) {
    if (n.type === "dir" && n.path === dir) return n;
    const hit = n.children ? findDirNode(n.children, dir) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

/** mock 预览的动画抑制样式(与注入 shim 的 ps-noanim 同款) */
function suppressPageAnimTag(html: string): string {
  const style = `<style id="ps-noanim">*, *::before, *::after { animation: none !important; } .ps-loader { display: none !important; }</style>`;
  const idx = html.lastIndexOf("</head>");
  return idx >= 0 ? html.slice(0, idx) + style + html.slice(idx) : style + html;
}

/** 预览通道的搜索索引:全部文档 + 无 index.md 目录的目录页(与构建产物的收录范围一致) */
function previewSearchPages(metas: Map<string, DocMeta>, tree: TreeNode[]): SearchPage[] {
  const pages: SearchPage[] = [];
  const hasIndex = new Set<string>();
  for (const m of metas.values()) {
    if (basename(m.path).toLowerCase() === "index.md") hasIndex.add(dirname(m.path).toLowerCase());
    if (m.hidden) continue; // 隐藏文档不入搜索数据
    pages.push({ title: m.title, url: mdToHtml(m.path), desc: m.description, text: mdToText(m.body) });
  }
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.type === "dir" && !isAssetDir(n.path) && !hasIndex.has(n.path.toLowerCase())) {
        const titles = (n.children ?? [])
          .filter((c) => c.type === "file" && isMarkdown(c.path))
          .map((c) => metas.get(c.path)?.title ?? stripExt(c.name));
        pages.push({
          title: n.name,
          url: mdToHtml(`${n.path}/index.md`),
          text: titles.join(" "),
        });
      }
      if (n.children?.length) walk(n.children);
    }
  };
  walk(tree);
  return pages;
}

/** 构建站点。root 为发起构建时的站点根:落盘三命令携 root 交后端校验,
 *  构建期间切换站点时旧构建被拒绝,产物不会写入新站点目录 */
export async function buildSite(site: SiteConfig, theme: ThemeBundle, root: string): Promise<BuildReport> {
  const t0 = performance.now();
  const tree = await ipc.listTree();

  const mdPaths: string[] = [];
  const assetCopies: CopyItem[] = [];
  const dirSet = new Set<string>();
  walkTree(tree, (node) => {
    if (node.type === "dir") dirSet.add(node.path.toLowerCase());
    else if (isMarkdown(node.path)) mdPaths.push(node.path);
    else assetCopies.push({ src: `content/${node.path}`, dest: node.path });
  });

  const contents = await ipc.readDocs(mdPaths);
  const cache: DocsCache = {};
  mdPaths.forEach((path, i) => (cache[path] = contents[i] ?? ""));

  const docMap = new Map<string, string>();
  const metas = buildMetas(mdPaths, cache);
  for (const p of mdPaths) docMap.set(p.toLowerCase(), p);

  const config = mergeConfigDefaults(theme.meta, site.theme.config);
  const render = compileTheme(theme);
  const navRaw = buildNav(tree, metas);
  const siteType = site.siteType ?? "docs";
  const isBlog = siteType === "blog";
  const docExtras: BlogHomeExtras = { siteType };
  // 博客首页分页:每页文章数来自主题配置,文章流拆成 index.html + page/N 系列页
  const allPosts = isBlog ? buildPosts(metas) : [];
  const perPage = postsPerPageOf(config);
  const totalPages = Math.max(1, Math.ceil(allPosts.length / perPage));
  const warnings: BuildWarning[] = [];
  const outputs: OutputFile[] = [];
  /** 搜索索引条目随页面渲染同步收集(标题/描述/正文纯文本);隐藏文档不入索引 */
  const searchPages: SearchPage[] = [];
  const emit = (path: string, html: string, title: string, desc?: string, indexable = true) => {
    outputs.push({ path, content: html });
    if (indexable) searchPages.push({ title, url: path, desc, text: htmlToText(html) });
  };

  // 主题文本资源(css/js 等)落到 build 根
  for (const [path, content] of Object.entries(theme.files)) {
    if (path.startsWith("assets/")) outputs.push({ path, content });
  }
  // 内置插件文件(只写启用的);用户插件从 .plainstruct/plugins/ 拷入产物
  outputs.push(...builtinPluginOutputs(site));
  assetCopies.push(...pluginCopyItems(site));

  // 站点图片(站点内 logo 与站点外 favicon):统一落在 build/assets 下供页面引用
  if (site.logo) {
    assetCopies.push({ src: `.plainstruct/assets/${site.logo}`, dest: `assets/${site.logo}` });
  }
  if (site.favicon && site.favicon !== site.logo) {
    assetCopies.push({ src: `.plainstruct/assets/${site.favicon}`, dest: `assets/${site.favicon}` });
  }

  for (const doc of metas.values()) {
    // 博客的根 index.md 属于首页系列(公告正文 + 文章流),在下方单独渲染
    if (isBlog && doc.path.toLowerCase() === "index.md") continue;
    const { html } = renderOnePage(
      site,
      config,
      render,
      navRaw,
      docMap,
      dirSet,
      doc,
      warnings,
      undefined,
      undefined,
      undefined,
      docExtras,
    );
    emit(mdToHtml(doc.path), html, doc.title, doc.description, !doc.hidden);
  }

  // 根目录:无 index.md 时自动生成首页,保证 index.html 始终存在;
  // 文档站点为介绍页(TOC),博客站点为第 1 页文章流
  // 博客主页 extras 按主页配置头裁剪(分类分组 / 自定义显示文章)
  const rootIndex = mdPaths.find((p) => p.toLowerCase() === "index.md");
  const homeDoc = rootIndex ? metas.get(rootIndex) : undefined;
  const homeExtras = isBlog
    ? blogHomeExtrasFor(siteType, allPosts, homeDoc, config, tree, metas)
    : docExtras;
  if (!rootIndex) {
    const home: DocMeta = {
      path: "index.md",
      title: site.name,
      description: site.description,
      order: 0,
      body: isBlog ? "" : tocHtml(navRaw, ""),
    };
    const { html } = renderOnePage(site, config, render, navRaw, docMap, dirSet, home, warnings, undefined, undefined, undefined, homeExtras);
    emit("index.html", html, site.name, site.description);
  } else if (isBlog) {
    // 有 index.md:正文作为公告栏显示在文章流上方
    const { html } = renderOnePage(site, config, render, navRaw, docMap, dirSet, homeDoc!, warnings, undefined, undefined, undefined, homeExtras);
    emit("index.html", html, homeDoc!.title, homeDoc!.description);
  }

  // 博客首页系列第 2..N 页(page/N/index.html);主页配置头开启分类分组时整流展示,不生成系列页
  if (isBlog && !homeExtras.postGroups) {
    for (let n = 2; n <= totalPages; n++) {
      const pseudo: DocMeta = { path: `page/${n}/index.md`, title: site.name, order: 0, body: "" };
      const slice = allPosts.slice((n - 1) * perPage, n * perPage);
      const { html } = renderOnePage(
        site,
        config,
        render,
        navRaw,
        docMap,
        dirSet,
        pseudo,
        warnings,
        undefined,
        undefined,
        undefined,
        { siteType, posts: slice, pagination: { current: n, total: totalPages } },
      );
      emit(`page/${n}/index.html`, html, site.name);
    }
  }

  // 文件夹页:每个没有 index.md 的目录生成一个落地页(dir/index.html);资产目录除外。
  // 博客站点为分类落地页:缺省卡片流(该目录递归内的文章),可在文件树配置为目录列表
  const folderConfigs = isBlog ? await ipc.readFolderConfigs() : {};
  const htmlToMd = htmlToMdMap(metas);
  const folderPages: DocMeta[] = [];
  walkTree(tree, (node) => {
    if (node.type !== "dir" || isAssetDir(node.path)) return;
    const children = node.children ?? [];
    if (children.some((c) => c.type === "file" && c.name.toLowerCase() === "index.md")) return;
    folderPages.push({
      path: `${node.path}/index.md`,
      title: node.name,
      order: 0,
      body: tocHtml(buildNav(children, metas), node.path),
    });
  });
  for (const page of folderPages) {
    let extras: BlogHomeExtras = docExtras;
    if (isBlog && (folderConfigs[dirname(page.path)]?.view ?? "stream") === "stream") {
      extras = { siteType, folderPosts: postsInDir(allPosts, htmlToMd, dirname(page.path)) };
    }
    const { html } = renderOnePage(site, config, render, navRaw, docMap, dirSet, page, warnings, undefined, undefined, undefined, extras);
    emit(mdToHtml(page.path), html, page.title);
  }

  // 博客归档页:全部非隐藏文章(卡片流)+ 分类分组 + 年份分组;三种视图客户端切换。
  // 不进搜索索引(归档是导航页,整页文章标题的拼接文本只会稀释搜索质量)
  if (isBlog) {
    const archiveExtras: BlogHomeExtras = {
      siteType,
      archive: { posts: allPosts, groups: buildPostGroups(tree, metas, allPosts, homeDoc), years: buildArchiveYears(allPosts) },
    };
    const archiveDoc: DocMeta = { path: "archive/index.md", title: "归档", order: 0, body: "" };
    const { html } = renderOnePage(site, config, render, navRaw, docMap, dirSet, archiveDoc, warnings, undefined, undefined, undefined, archiveExtras);
    emit("archive/index.html", html, "归档", undefined, false);
  }

  // 搜索索引(构建产物懒加载;预览通道为内联数据,见 renderPreview)
  if (normalizePlugins(site).search) {
    outputs.push({ path: "assets/ps-plugins/search-index.json", content: JSON.stringify({ pages: searchPages }) });
  }

  // 每页注入插件引用:样式与脚本按页面深度换算相对地址,置于 </body> 前
  for (const out of outputs) {
    if (out.path.endsWith(".html")) {
      out.content = injectPluginTags(out.content, pluginTags(relPrefix(out.path), site));
    }
  }

  await ipc.clearBuild(root);
  await ipc.writeBuildFiles(root, outputs);
  const totalSize = await ipc.copyPaths(root, assetCopies);

  return {
    pages: outputs.filter((o) => o.path.endsWith(".html")).length,
    assets: assetCopies.length,
    warnings,
    durationMs: Math.round(performance.now() - t0),
    totalSize,
  };
}
