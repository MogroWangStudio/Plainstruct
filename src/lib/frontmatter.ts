/** 极简 front-matter:文件起始 --- 包围块,支持 title / order / description / date */

export interface FrontMatter {
  title?: string;
  order?: number;
  description?: string;
  /** 发布日期,如 2026-09-26;原样保留,展示格式由主题决定 */
  date?: string;
  /** 封面图(博客文章流展示):图片路径(相对本文档)或外链 URL */
  cover?: string;
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
  }
  // 结束围栏缺失时视为普通正文,不吞内容
  if (end === -1) return { data: {}, body: src };
  const body = lines.slice(end + 1).join("\n");
  return { data, body: body.replace(/^\r?\n/, "") };
}
