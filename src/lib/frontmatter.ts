/** 素构识别的配置头字段(写回时以表单值为准重建这些行;表单未管理的字段
 *  不在此列 —— 用户手写的行原样保留,如 order) */
export const FM_KEYS = ["title", "description", "date", "cover", "author", "aigc", "hidden", "toc", "homegroups", "homeuncategorized", "homeuncategorizedlabel"];

/** AIGC 声明:present = 存在 AIGC,none = 无任何 AIGC;缺省(不写字段)即不显示声明 */
export type AigcDeclaration = "none" | "present";

/**
 * 把表单值写回文档内容:识别字段以表单为准(留空不写),用户手写的其它行原样保留;
 * 文档没有配置头时在最前生成完整块。
 */
export function applyFrontMatter(
  content: string,
  values: {
    title?: string;
    description?: string;
    date?: string;
    cover?: string;
    author?: string;
    /** AIGC 声明 */
    aigc?: AigcDeclaration | "";
    hidden?: boolean;
    /** 页面目录(博客文章页):on = 强制显示,false = 强制隐藏,"" = 不落字段,跟随主题设置 */
    toc?: "" | "on" | "off";
    /** 博客主页(根 index.md)专属:卡片流按分类分组 */
    homeGroups?: boolean;
    /** 博客主页专属:分组时是否显示「未分类」组(根级文章);缺省显示,隐藏时写 false */
    homeUncategorized?: boolean;
    /** 博客主页专属:「未分类」组的自定义标题;空 = 缺省「未分类」 */
    homeUncategorizedLabel?: string;
  },
): string {
  const fields = [
    ...(values.title?.trim() ? [`title: ${values.title.trim()}`] : []),
    ...(values.description?.trim() ? [`description: ${values.description.trim()}`] : []),
    ...(values.date?.trim() ? [`date: ${values.date.trim()}`] : []),
    ...(values.cover?.trim() ? [`cover: ${values.cover.trim()}`] : []),
    ...(values.author?.trim() ? [`author: ${values.author.trim()}`] : []),
    ...(values.aigc === "none" || values.aigc === "present" ? [`aigc: ${values.aigc}`] : []),
    ...(values.hidden ? ["hidden: true"] : []),
    ...(values.toc === "on" ? ["toc: true"] : values.toc === "off" ? ["toc: false"] : []),
    ...(values.homeGroups ? ["homeGroups: true"] : []),
    // 显示未分类是缺省行为(不写字段);仅在用户隐藏时落 false
    ...(values.homeGroups && values.homeUncategorized === false ? ["homeUncategorized: false"] : []),
    ...(values.homeGroups && values.homeUncategorizedLabel?.trim()
      ? [`homeUncategorizedLabel: ${values.homeUncategorizedLabel.trim()}`]
      : []),
  ];
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
  if (!m) {
    return `---\n${fields.join("\n")}\n---\n\n${content}`;
  }
  const kept = m[1]
    .split(/\r?\n/)
    .filter((l) => l.trim() && !FM_KEYS.some((k) => l.toLowerCase().trimStart().startsWith(`${k}:`)));
  return `---\n${[...fields, ...kept].join("\n")}\n---\n${content.slice(m[0].length)}`;
}

/** 极简 front-matter:文件起始 --- 包围块,支持 title / order / description / date */

export interface FrontMatter {
  title?: string;
  order?: number;
  description?: string;
  /** 发布日期,如 2026-09-26;原样保留,展示格式由主题决定 */
  date?: string;
  /** 封面图(博客文章流展示):图片路径(相对本文档)或外链 URL */
  cover?: string;
  /** 作者署名(文档页展示;缺省不显示) */
  author?: string;
  /** AIGC 声明:缺省不显示 */
  aigc?: AigcDeclaration;
  /** 隐藏文档:不进文章流与导航、不入搜索索引,仅可通过链接访问 */
  hidden?: boolean;
  /** 页面目录开关(博客文章页):true = 强制显示,false = 强制隐藏;缺省跟随主题设置 */
  toc?: boolean;
  /** 博客主页(根 index.md)专属:卡片流按分类分组(分类 = 顶层文件夹) */
  homeGroups?: boolean;
  /** 博客主页专属:分组时显示「未分类」组(根级文章);缺省显示 */
  homeUncategorized?: boolean;
  /** 博客主页专属:「未分类」组的自定义标题 */
  homeUncategorizedLabel?: string;
}

export interface ParsedDoc {
  data: FrontMatter;
  body: string;
}

const FENCE = /^---\r?\n/;
const FENCE_END = /^(---|\.\.\.)\s*$/;

export function parseFrontMatter(src: string): ParsedDoc {
  if (!FENCE.test(src)) return { data: {}, body: src };
  const rest = src.slice(src.indexOf("\n") + 1);
  const lines = rest.split(/\r?\n/);
  const data: FrontMatter = {};
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_END.test(lines[i])) {
      end = i;
      break;
    }
    const m = lines[i].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (key === "title") data.title = value;
    else if (key === "cover") data.cover = value;
    else if (key === "order") {
      const n = Number(value);
      if (Number.isFinite(n)) data.order = n;
    } else if (key === "description") data.description = value;
    else if (key === "date") data.date = value;
    else if (key === "author") data.author = value;
    else if (key === "aigc") {
      // 只认两档声明;缺省与非法值都不显示
      if (value === "none" || value === "present") data.aigc = value;
    } else if (key === "hidden") {
      if (value === "true" || value === "1") data.hidden = true;
    } else if (key === "toc") {
      // 页面目录三态:缺省(不写字段)跟随主题设置,显式 true/false 强制覆盖
      if (value === "true" || value === "1") data.toc = true;
      else if (value === "false" || value === "0") data.toc = false;
    } else if (key === "homegroups") {
      if (value === "true" || value === "1") data.homeGroups = true;
    } else if (key === "homeuncategorized") {
      if (value === "false" || value === "0") data.homeUncategorized = false;
    } else if (key === "homeuncategorizedlabel") {
      if (value) data.homeUncategorizedLabel = value;
    }
  }
  // 结束围栏缺失时视为普通正文,不吞内容
  if (end === -1) return { data: {}, body: src };
  const body = lines.slice(end + 1).join("\n");
  return { data, body: body.replace(/^\r?\n/, "") };
}
