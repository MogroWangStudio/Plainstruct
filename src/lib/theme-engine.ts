/** 主题引擎 -- Handlebars 声明式模板,构建与预览共用 */
import Handlebars from "handlebars";
import type { ThemeMeta } from "@/ipc/types";
import { encodePath, relPrefix } from "./paths";

export interface ThemeBundle {
  meta: ThemeMeta;
  /** 路径 -> 文件内容,如 "templates/layout.hbs" */
  files: Record<string, string>;
}

export interface NavItem {
  title: string;
  url?: string;
  children?: NavItem[];
  current?: boolean;
}

/** 博客首页文章流的条目(htmlPath 为 content/ 相对源路径,渲染时换算为页面相对地址) */
export interface PostSummary {
  title: string;
  htmlPath: string;
  url?: string;
  date?: string;
  description?: string;
  /** 封面图:content/ 相对路径或外链 URL,渲染时换算为页面相对地址 */
  cover?: string;
}

/** 主页分类卡片流的一组(分类标题 + 组内文章):
 *  extras 阶段 url 为分类落地页的 content/ 相对 htmlPath,渲染时换算为页面相对地址 */
export interface PostGroup {
  title: string;
  url?: string;
  posts: PostSummary[];
}

export interface TocEntry {
  level: number;
  text: string;
  id: string;
}

/** 博客首页文章流分页(构建时按每页文章数生成 page/N 系列页) */
export interface PaginationInfo {
  /** 当前页码,从 1 起 */
  current: number;
  /** 总页数 */
  total: number;
  pages: { n: number; url: string; current: boolean }[];
  prevUrl?: string;
  nextUrl?: string;
}

export interface PageContext {
  site: {
    name: string;
    description?: string;
    logo?: string;
    /** 浏览器标签页图标;未单独设置时回退为站点内 logo */
    favicon?: string;
    locale?: string;
  };
  page: {
    title: string;
    description?: string;
    content: string;
    path: string;
    url: string;
    relPrefix: string;
    /** 浏览器标签页标题(按站点 titleFormat 拼接) */
    fullTitle?: string;
    /** 当前页在导航中的面包屑(不含页面自身),移动端顶栏展示 */
    crumbs?: string[];
    /** front-matter 中的发布日期,原样输出 */
    date?: string;
    /** front-matter 中的作者署名,缺省不显示 */
    author?: string;
    /** front-matter 中的 AIGC 声明(none/present),缺省不显示 */
    aigc?: string;
    /** 当前页是否站点根 index(博客主题据此渲染文章流) */
    isHome?: boolean;
    /** 页内标题大纲(博客主题文章页的 TOC 侧栏) */
    toc?: TocEntry[];
    /** 文章流分页(仅博客首页系列页存在) */
    pagination?: PaginationInfo;
    /** 主页分类卡片流(主页配置头 homeGroups 开启时;渲染按组展示,不分页) */
    postGroups?: PostGroup[];
    /** 博客文件夹落地页的卡片流视图(该目录递归内的文章) */
    folderPosts?: PostSummary[];
  };
  nav: NavItem[];
  prev?: { title: string; url: string };
  next?: { title: string; url: string };
  /** 博客站点:全部文章(按日期倒序),首页渲染文章流 */
  posts?: PostSummary[];
  config: Record<string, string | number | boolean>;
}

/** 配置值与主题默认值合并(缺省字段用 default) */
export function mergeConfigDefaults(
  meta: ThemeMeta,
  values: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> {
  const merged: Record<string, string | number | boolean> = {};
  for (const field of meta.config ?? []) {
    const v = values?.[field.key];
    merged[field.key] = v === undefined || v === null ? (field.default ?? "") : v;
  }
  return merged;
}

/** 校验主题完整性:必须包含 templates/layout.hbs */
export function validateTheme(bundle: ThemeBundle): string | null {
  if (!bundle.files["templates/layout.hbs"]) return "missing layout";
  if (!bundle.meta?.id) return "missing id";
  return null;
}

const FALLBACK_PAGE_PARTIAL = "{{{page.content}}}";

/** 编译一次,渲染多页。renderPage 内部按页注入 asset 相对路径。 */
export function compileTheme(bundle: ThemeBundle): (ctx: PageContext) => string {
  const hb = Handlebars.create();
  for (const [path, content] of Object.entries(bundle.files)) {
    if (path.startsWith("partials/") && path.endsWith(".hbs")) {
      const name = path.slice("partials/".length, -".hbs".length);
      hb.registerPartial(name, content);
    }
  }
  hb.registerPartial("page", bundle.files["templates/page.hbs"] ?? FALLBACK_PAGE_PARTIAL);
  hb.registerHelper("asset", (path: string, options: { data?: { root?: PageContext } }) => {
    const prefix = options?.data?.root?.page?.relPrefix ?? "";
    return encodePath(prefix + path);
  });
  hb.registerHelper("eq", (a: unknown, b: unknown) => a === b);

  const layout = hb.compile(bundle.files["templates/layout.hbs"], { noEscape: false });
  return (ctx: PageContext) =>
    layout({ ...ctx, page: { ...ctx.page, relPrefix: relPrefix(ctx.page.url) } });
}

/** 渲染主题预览图/示例页(与正式渲染同一路径) */
export function renderPage(theme: ThemeBundle, ctx: PageContext): string {
  return compileTheme(theme)(ctx);
}
