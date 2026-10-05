<script setup lang="ts">
/** CodeMirror 6 Markdown 编辑器 -- 格式工具栏 + 快捷键 + 列表续行 + 空白标记,素构浅色高亮 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Decoration, DecorationSet, EditorView, keymap, KeyBinding, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { Compartment, EditorState, type Extension, type Text, RangeSetBuilder } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as tg } from "@lezer/highlight";
import { useEditorStore } from "@/stores/editor";
import { useAppStore } from "@/stores/app";
import { useSiteStore } from "@/stores/site";
import { useUiStore } from "@/stores/ui";
import { ipc } from "@/ipc/ipc";
import { applyFrontMatter, parseFrontMatter } from "@/lib/frontmatter";
import { encodePath, stripExt, ASSET_MIME, assetRefPrefix, relPosix } from "@/lib/paths";
import { IMG_PREVIEW_MARK } from "@/lib/plugins";
import { registerCmView, unregisterCmView } from "@/lib/contextMenu";
import AppIcon from "@/components/AppIcon.vue";
import FrontMatterModal, { type FrontMatterForm } from "@/components/FrontMatterModal.vue";
import ImageInsertModal, { type ImageInsertResult, type ImageInsertSource } from "@/components/ImageInsertModal.vue";

const { t } = useI18n();
const editor = useEditorStore();
const app = useAppStore();
const site = useSiteStore();
const ui = useUiStore();
const host = ref<HTMLElement>();
let view: EditorView | null = null;

/** 快捷键提示里的主修饰键:mac 用 ⌘,其余显示 Ctrl */
const mod = app.platform === "macos" ? "⌘" : "Ctrl";

/* ---------- 写作偏好(空白标记 + 换行/缩进键位),设置页即时可改 ---------- */

const breakLabel = computed(() => {
  const k = app.settings.editorBreakKey ?? "enter";
  return k === "enter" ? "Enter" : k === "modEnter" ? `${mod}Enter` : "";
});
const indentLabel = computed(() => {
  const k = app.settings.editorIndentKey ?? "tab";
  return k === "tab" ? "Tab" : k === "modShiftI" ? `${mod}⇧I` : "";
});
const breakTitle = computed(() =>
  breakLabel.value ? `${t("editor.toolbar.break")} (${breakLabel.value})` : t("editor.toolbar.break"),
);
const indentTitle = computed(() =>
  indentLabel.value ? `${t("editor.toolbar.indent")} (${indentLabel.value})` : t("editor.toolbar.indent"),
);

const plainHighlight = HighlightStyle.define([
  { tag: tg.heading, fontWeight: "600", color: "var(--color-ink)" },
  { tag: [tg.heading1], fontWeight: "700", fontSize: "1.18em" },
  { tag: [tg.heading2], fontWeight: "650", fontSize: "1.1em" },
  { tag: tg.strong, fontWeight: "650" },
  { tag: tg.emphasis, fontStyle: "italic" },
  { tag: tg.link, color: "var(--color-accent)", textDecoration: "underline" },
  { tag: [tg.monospace, tg.inserted], fontFamily: "var(--font-mono)", color: "var(--color-ink-2)" },
  { tag: [tg.quote], color: "var(--color-ink-2)", fontStyle: "italic" },
  { tag: [tg.meta, tg.processingInstruction, tg.comment], color: "var(--color-ink-3)" },
  { tag: tg.strikethrough, textDecoration: "line-through", color: "var(--color-ink-3)" },
]);

/* ---------- 选区编辑辅助 ---------- */

/** 提交一次变更并聚焦;sel 为相对变更后的绝对位置 */
function commit(from: number, to: number, insert: string, anchor: number, head: number) {
  if (!view) return;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor, head }, scrollIntoView: true });
  view.focus();
}

/** 紧贴选区某一侧的连续标记字符数(限同一行,用于判断格式是否已应用) */
function markerRun(ch: string, side: "left" | "right"): number {
  if (!view) return 0;
  const { state } = view;
  const range = state.selection.main;
  const pos = side === "left" ? range.from : range.to;
  const line = state.doc.lineAt(pos);
  let n = 0;
  while (
    side === "left"
      ? pos - 1 - n >= line.from && state.sliceDoc(pos - 1 - n, pos - n) === ch
      : pos + n < line.to && state.sliceDoc(pos + n, pos + n + 1) === ch
  ) {
    n++;
  }
  return n;
}

/**
 * 行内栈式配对:扫描当前行中成对的 before...after 标记,
 * 返回包含选区(或光标)的最内层包裹;跨行或未命中返回 null。
 */
function enclosingPair(
  before: string,
  after: string,
): { from: number; to: number; innerFrom: number; innerTo: number } | null {
  if (!view) return null;
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  if (state.doc.lineAt(range.to).number !== line.number) return null;
  const text = line.text;
  const localFrom = range.from - line.from;
  const localTo = range.to - line.from;
  const stack: number[] = [];
  let i = 0;
  while (i <= text.length - before.length) {
    if (text.startsWith(before, i)) {
      stack.push(i);
      i += before.length;
      continue;
    }
    if (stack.length && text.startsWith(after, i)) {
      const start = stack.pop()!;
      const innerFrom = start + before.length;
      const innerTo = i;
      if (innerTo > innerFrom && localFrom >= innerFrom && localTo <= innerTo) {
        return {
          from: line.from + start,
          to: line.from + i + after.length,
          innerFrom: line.from + innerFrom,
          innerTo: line.from + innerTo,
        };
      }
      i += after.length;
      continue;
    }
    i++;
  }
  return null;
}

/**
 * 包裹/解除包裹选区;无选区时插入一对符号并置于中间。
 * 选中文本或光标所在处已被相同格式包裹时,再次按下即取消该格式;
 * 斜体按单个 `*` 判定,连续偶数个 `*` 属于加粗标记,不算斜体已应用。
 */
function wrapSelection(before: string, after: string = before) {
  if (!view) return;
  const { state } = view;
  const range = state.selection.main;
  const text = state.sliceDoc(range.from, range.to);
  // 选区完整包含包裹对:剥离
  if (
    text.length >= before.length + after.length &&
    text.startsWith(before) &&
    text.endsWith(after)
  ) {
    const inner = text.slice(before.length, text.length - after.length);
    commit(range.from, range.to, inner, range.from + before.length, range.from + before.length + inner.length);
    return;
  }
  // 选区/光标位于同行的完整包裹对内部(部分选中、光标悬停均可):整对剥离。
  // 单个 `*` 与加粗的 `**` 字符重叠,无法无歧义配对,只走下方紧邻检测
  const pair = before === "*" ? null : enclosingPair(before, after);
  if (pair) {
    const inner = state.sliceDoc(pair.innerFrom, pair.innerTo);
    commit(pair.from, pair.to, inner, pair.innerFrom, pair.innerTo);
    return;
  }
  // 选区紧贴成对标记(包裹结构不规范时的兜底):按字符数剥离一层
  const ch = before[0];
  const ln = markerRun(ch, "left");
  const rn = markerRun(ch, "right");
  const applied =
    before === "*"
      ? ln >= 1 && rn >= 1 && ln % 2 === 1 && rn % 2 === 1
      : ln >= before.length && rn >= after.length;
  if (applied) {
    const drop = Math.min(before.length, ln, rn);
    commit(
      range.from - drop,
      range.to + drop,
      text,
      range.from - drop,
      range.from - drop + text.length,
    );
    return;
  }
  const insert = before + text + after;
  commit(range.from, range.to, insert, range.from + before.length, range.from + before.length + text.length);
}

/* ---------- 行级编辑辅助 ---------- */

const LIST_RE = /^(\s*)(?:[-*+]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s+)?/;
const hasBullet = (l: string) => /^(\s*)[-*+]\s+(?!\[[ xX]\]\s)/.test(l);
const hasOrdered = (l: string) => /^(\s*)\d+[.)]\s+/.test(l);
const hasTask = (l: string) => /^(\s*)[-*+]\s+\[[ xX]\]\s+/.test(l);
const QUOTE_RE = /^>\s?/;

/** 对选区覆盖的每一行应用变换 */
function transformLines(fn: (line: string, index: number, lines: string[]) => string) {
  if (!view) return;
  const { state } = view;
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from);
  const last = state.doc.lineAt(range.to);
  const lines: string[] = [];
  for (let n = first.number; n <= last.number; n++) lines.push(state.doc.line(n).text);
  const next = lines.map(fn);
  if (next.every((l, i) => l === lines[i])) return;
  const insert = next.join("\n");
  // 行变换不改变行数,按原选区的行列位置映射到新文本,避免光标跳到块尾
  const newLines = insert.split("\n");
  const starts: number[] = [];
  let acc = first.from;
  for (const l of newLines) {
    starts.push(acc);
    acc += l.length + 1;
  }
  const anchorLine = state.doc.lineAt(range.anchor);
  const headLine = state.doc.lineAt(range.head);
  const anchor = starts[anchorLine.number - first.number] + Math.min(range.anchor - anchorLine.from, newLines[anchorLine.number - first.number].length);
  const head = starts[headLine.number - first.number] + Math.min(range.head - headLine.from, newLines[headLine.number - first.number].length);
  commit(first.from, last.to, insert, anchor, head);
}

function toggleBullet() {
  transformLines((l, _i, lines) => {
    const stripped = l.replace(LIST_RE, "$1");
    return lines.every(hasBullet) ? stripped : stripped.replace(/^(\s*)/, "$1- ");
  });
}

function toggleOrdered() {
  transformLines((l, i, lines) => {
    const stripped = l.replace(LIST_RE, "$1");
    return lines.every(hasOrdered) ? stripped : stripped.replace(/^(\s*)/, `$1${i + 1}. `);
  });
}

function toggleTask() {
  transformLines((l, _i, lines) => {
    const stripped = l.replace(LIST_RE, "$1");
    return lines.every(hasTask) ? stripped : stripped.replace(/^(\s*)/, "$1- [ ] ");
  });
}

function toggleQuote() {
  transformLines((l, _i, lines) => {
    const stripped = l.replace(QUOTE_RE, "");
    return lines.every((x) => QUOTE_RE.test(x)) ? stripped : `> ${stripped}`;
  });
}

/* ---------- 中文写作格式 ---------- */

/** 段首缩进符:单个全角空格;数量由设置决定(中文常用 2 个) */
const INDENT = "　";
/** 结构性行(列表/引用/标题/表格/围栏)不做首行缩进,避免破坏 Markdown 结构 */
const BLOCK_LINE_RE = /^(?:\s*(?:[-*+]|\d+[.)])\s|>|#{1,6}\s|\||\s*```)/;

/** 每次缩进添加的全角空格数量(设置项,中文常用 2) */
function indentWidth(): number {
  const n = Math.floor(Number(app.settings.editorIndentWidth));
  return Number.isFinite(n) ? Math.min(4, Math.max(1, n)) : 2;
}

/** 添加缩进:对选区覆盖的每一行行首插入 N 个全角空格 */
function indentLines() {
  if (!view) return;
  const unit = INDENT.repeat(indentWidth());
  transformLines((l) => (BLOCK_LINE_RE.test(l) ? l : unit + l));
}

/** 移除缩进:每行行首剥掉一层缩进(Shift+Tab) */
function outdentLines() {
  if (!view) return;
  const unit = INDENT.repeat(indentWidth());
  transformLines((l) => {
    if (l.startsWith(unit)) return l.slice(unit.length);
    if (l.startsWith(INDENT)) return l.slice(INDENT.length);
    return l;
  });
}

/** 硬换行:Markdown 行尾两空格 + 换行;前方已是两空格时只换行,空行与行首同样生效 */
function insertBreak() {
  if (!view) return;
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.to);
  const before = state.sliceDoc(Math.max(line.from, range.to - 2), range.to);
  const insert = (before === "  " ? "" : "  ") + "\n";
  commit(range.from, range.to, insert, range.from + insert.length, range.from + insert.length);
}

function setHeading(level: number) {
  transformLines((l, _i, lines) => {
    const m = l.match(/^(#{1,6})\s+/);
    const stripped = m ? l.slice(m[0].length) : l;
    const allLevel = lines.every((x) => x.match(/^#{1,6}\s+/)?.[1].length === level);
    return allLevel ? stripped : `${"#".repeat(level)} ${stripped}`;
  });
}

/* ---------- 插入类 ---------- */

function insertLink() {
  if (!view) return;
  const { state } = view;
  const range = state.selection.main;
  const text = state.sliceDoc(range.from, range.to) || t("editor.toolbar.linkText");
  const insert = `[${text}](https://)`;
  const urlFrom = range.from + text.length + 3;
  commit(range.from, range.to, insert, urlFrom, urlFrom + 8);
}

/** 文档开头 --- 包围块(front-matter)的结束位置(闭合围栏行尾);不含 front-matter 的文档返回 null */
function frontMatterEnd(doc: Text): number | null {
  if (doc.line(1).text.trim() !== "---") return null;
  for (let n = 2; n <= doc.lines; n++) {
    if (/^(---|\.\.\.)\s*$/.test(doc.line(n).text)) return doc.line(n).to;
  }
  return null;
}

/* ---------- 配置头可视化编辑:表单弹窗(FrontMatterModal),确认后就地写回 ---------- */

const fmOpen = ref(false);
const fmInitial: FrontMatterForm = reactive({ title: "", description: "", date: "", cover: "", author: "", aigc: "", hidden: false, homeGroups: false, homePosts: [] });

/** 博客主页(根 index.md)配置区数据:候选文章列表;非博客或非主页为 null */
const blogHomeOptions = computed(() => {
  const opts = site.blogHomePostOptions;
  if (!opts || !editor.activePath || editor.activePath.toLowerCase() !== "index.md") return null;
  return { posts: opts };
});

/** 当前文档位置引用站点资产的路径前缀(根级 asset/…,子目录 ../asset/…) */
function coverPrefix(): string {
  const depth = editor.activePath ? editor.activePath.split("/").length - 1 : 0;
  return assetRefPrefix(depth);
}

/** 今天的本地日期(YYYY-MM-DD;toISOString 按 UTC 会在东八区晚间差一天) */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 打开表单:预填当前配置头的字段值(没有配置头时 title/date 给出默认) */
function openFmEditor() {
  if (!view) return;
  const parsed = parseFrontMatter(view.state.sliceDoc(0, view.state.doc.length));
  const isNew = frontMatterEnd(view.state.doc) === null;
  fmInitial.title = parsed.data.title ?? (isNew ? editor.docTitle : "");
  fmInitial.description = parsed.data.description ?? "";
  fmInitial.date = parsed.data.date ?? (isNew ? todayLocal() : "");
  fmInitial.cover = parsed.data.cover ?? "";
  fmInitial.author = parsed.data.author ?? "";
  fmInitial.aigc = parsed.data.aigc ?? "";
  fmInitial.hidden = parsed.data.hidden === true;
  // 主页配置区预填:已有 homePosts 按其勾选,否则全勾(= 显示全部)
  const opts = blogHomeOptions.value?.posts;
  const isHomeDoc = !!opts;
  fmInitial.homeGroups = isHomeDoc && parsed.data.homeGroups === true;
  fmInitial.homePosts = isHomeDoc ? (parsed.data.homePosts ?? opts!.map((o) => o.path)) : [];
  fmOpen.value = true;
}

/** 把表单值写回 front-matter:识别字段以表单为准,用户手写的其它字段原样保留 */
function writeFrontMatter(form: FrontMatterForm) {
  if (!view) return;
  const next = applyFrontMatter(view.state.doc.toString(), form);
  commit(0, view.state.doc.length, next, next.length, next.length);
  fmOpen.value = false;
}

/** HTML 属性/文本转义(< > & ") */
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * 插入图片(批量路径):选取后统一复制进站点 asset 文件夹(自动建目录、重名加序号),
 * 在光标处插入按当前文档位置换算的相对路径(根级文档 asset/…,子目录 ../asset/…),
 * 构建与预览都能正确显示;光标落在 front-matter 内时移到其后插入,避免破坏元数据块;
 * 资产栏同步刷新,并以提示说明图片去向。asFigure 时以 <figure class="ps-image">
 * 预览块包裹(带图注),配合站点图片预览插件可点击进入灯箱。
 */
async function insertImages(asFigure: boolean, preFiles?: string[]) {
  if (!view) return;
  const files = preFiles ?? (await ipc.pickImages());
  if (!files?.length) return;
  try {
    const names = await site.importSiteImages(files);
    if (!names.length) return;
    const pieces = names.map((name) => {
      const alt = stripExt(name) || t("editor.toolbar.imageAlt");
      return asFigure
        ? `<figure class="ps-image">\n  <img class="${IMG_PREVIEW_MARK}" src="${encodePath(coverPrefix() + name)}" alt="${escHtml(alt)}">\n  <figcaption>${escHtml(alt)}</figcaption>\n</figure>`
        : `![${alt}](${encodePath(coverPrefix() + name)})`;
    });
    const markdown = pieces.join("\n");
    const { from, to, lead } = computeInsertRange();
    const insert = lead + markdown;
    commit(from, to, insert, from + insert.length, from + insert.length);
    ui.toast(t("editor.imageImported", { n: names.length }), "success");
  } catch (e) {
    ui.toast(t("editor.imageImportFailed", { msg: ipc.errText(e) }), "error");
  }
}

/** 插入落点:光标在 front-matter 内时移到元数据块后的正文区,补空行分段 */
function computeInsertRange(): { from: number; to: number; lead: string } {
  const { state } = view!;
  const range = state.selection.main;
  const fmEnd = frontMatterEnd(state.doc);
  if (fmEnd !== null && range.from < fmEnd) return { from: fmEnd, to: fmEnd, lead: "\n\n" };
  return { from: range.from, to: range.to, lead: "" };
}

/* ---------- 插入图片配置弹窗:单张插入走弹窗(方式/路径/对齐/尺寸/class 可配),
   多张批量与预览块保持直插 ---------- */

const imageModalOpen = ref(false);
const imageSource = ref<ImageInsertSource | null>(null);
/** 打开弹窗时确定的插入位置(拖入为 drop 落点,工具栏为当前选区) */
let pendingImage: { from: number; to: number; lead: string } | null = null;

async function insertImage() {
  if (!view) return;
  const files = await ipc.pickImages();
  if (!files?.length) return;
  if (files.length === 1) {
    pendingImage = computeInsertRange();
    imageSource.value = { kind: "local", path: files[0] };
    imageModalOpen.value = true;
    return;
  }
  await insertImages(false, files);
}

/** 弹窗取消:清空暂存的来源与插入位置,不插入任何内容 */
function onImageInsertCancel() {
  imageModalOpen.value = false;
  imageSource.value = null;
  pendingImage = null;
}

/** 弹窗确认:本地文件按所选目标路径复制进站点(重名自动加序号),再按方式生成片段插入 */
async function onImageInsertConfirm(r: ImageInsertResult) {
  imageModalOpen.value = false;
  const pending = pendingImage;
  const source = imageSource.value;
  pendingImage = null;
  imageSource.value = null;
  if (!view || !source || !pending) return;
  try {
    const sitePath =
      source.kind === "local" && r.localSrc ? await site.importSiteImageTo(r.localSrc, r.sitePath) : r.sitePath;
    const docDir = editor.activePath ? editor.activePath.split("/").slice(0, -1).join("/") : "";
    const ref = relPosix(docDir, sitePath);
    const alt = r.alt || stripExt(sitePath.split("/").pop() ?? "") || t("editor.toolbar.imageAlt");
    let snippet: string;
    if (r.mode === "markdown") {
      snippet = `![${alt}](${encodePath(ref)})`;
    } else {
      const attrs = [`src="${encodePath(ref)}"`, `alt="${escHtml(alt)}"`];
      if (r.width) attrs.push(`width="${r.width}"`);
      if (r.height) attrs.push(`height="${r.height}"`);
      if (r.klass) attrs.push(`class="${escHtml(r.klass)}"`);
      const img = `<img ${attrs.join(" ")}>`;
      snippet = r.align === "none" ? img : `<div align="${r.align}">${img}</div>`;
    }
    const insert = pending.lead + snippet;
    view.dispatch({
      changes: { from: pending.from, to: pending.to, insert },
      selection: { anchor: pending.from + insert.length },
      scrollIntoView: true,
    });
    view.focus();
    ui.toast(t("editor.imageImported", { n: 1 }), "success");
  } catch (e) {
    ui.toast(t("editor.imageImportFailed", { msg: ipc.errText(e) }), "error");
  }
}

/** 插入图片预览块:<figure class="ps-image"> 包裹的图片 + 图注 */
async function insertImageFigure() {
  await insertImages(true);
}

/* ---------- 对齐:HTML 嵌入块 <div align="…">,构建与预览的主题样式均支持 ---------- */

type Align = "left" | "center" | "right";

const MD_IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)$/;
const HTML_IMAGE_LINE = /^<img\b[^>]*>$/;

/** 文字对齐:选区(或占位文字)包进对齐容器,光标落在内容上便于继续编辑 */
function alignText(align: Align) {
  if (!view) return;
  const { state } = view;
  const range = state.selection.main;
  const text = state.sliceDoc(range.from, range.to);
  const lead = range.from > 0 && text ? "\n\n" : "";
  const wrap = `<div align="${align}">`;
  const insert = `${lead}${wrap}${text}</div>`;
  const inner = range.from + lead.length + wrap.length;
  commit(range.from, range.to, insert, inner, inner + text.length);
}

/**
 * 图片对齐:选区或光标所在行是图片(md 或 <img>)时包进对齐容器;
 * 否则插入带占位路径的图片模板并选中路径,可直接粘贴或填写。
 */
function alignImage(align: Align) {
  if (!view) return;
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const selected = state.sliceDoc(range.from, range.to);
  const candidate = selected || (range.empty ? line.text.trim() : "");
  if (MD_IMAGE_LINE.test(candidate) || HTML_IMAGE_LINE.test(candidate)) {
    const from = selected ? range.from : line.from;
    const to = selected ? range.to : line.to;
    const insert = `<div align="${align}">${candidate}</div>`;
    commit(from, to, insert, from + insert.length, from + insert.length);
    return;
  }
  const alt = t("editor.toolbar.imageAlt");
  const src = "asset/图片.png";
  const lead = line.text.trim() ? "\n\n" : "";
  const wrap = `<div align="${align}">`;
  const tag = `<img src="${src}" alt="${alt}">`;
  const insert = `${lead}${wrap}${tag}</div>`;
  const srcFrom = range.from + lead.length + wrap.length + "<img src=\"".length;
  commit(range.from, range.to, insert, srcFrom, srcFrom + src.length);
}

function toggleCodeBlock() {
  if (!view) return;
  const { state } = view;
  const range = state.selection.main;
  const text = state.sliceDoc(range.from, range.to);
  if (text.startsWith("```\n") && text.endsWith("\n```")) {
    const inner = text.slice(4, -4);
    commit(range.from, range.to, inner, range.from, range.from + inner.length);
    return;
  }
  // 光标/选区处于 ``` 围栏内部(未选中围栏行):移除上下围栏行,保留代码内容
  const fenceRe = /^ {0,3}```/;
  const fromLine = state.doc.lineAt(range.from);
  const toLine = state.doc.lineAt(range.to);
  if (!fenceRe.test(fromLine.text) && !fenceRe.test(toLine.text)) {
    // 选区之前的围栏行为奇数个 = 当前处于某个围栏内部
    let fencesBefore = 0;
    let openNum = 0;
    for (let n = 1; n < fromLine.number; n++) {
      if (fenceRe.test(state.doc.line(n).text)) {
        fencesBefore++;
        openNum = n;
      }
    }
    if (fencesBefore % 2 === 1) {
      for (let n = toLine.number + 1; n <= state.doc.lines; n++) {
        const close = state.doc.line(n);
        if (fenceRe.test(close.text)) {
          const open = state.doc.line(openNum);
          view.dispatch({
            changes: [
              { from: open.from, to: open.to + 1 },
              { from: close.from, to: Math.min(close.to + 1, state.doc.length) },
            ],
            selection: { anchor: open.from },
            scrollIntoView: true,
          });
          view.focus();
          return;
        }
      }
    }
  }
  const insert = `\`\`\`\n${text}\n\`\`\``;
  commit(range.from, range.to, insert, range.from + 4, range.from + 4 + text.length);
}

function insertTable() {
  if (!view) return;
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.to);
  const head1 = t("editor.toolbar.tableHeader");
  const cell = t("editor.toolbar.tableCell");
  const header = `| ${head1} | ${head1} | ${head1} |`;
  const lead = line.text.trim() ? 1 : 0; // 非空行时 insert 以换行开头
  const insert = `${lead ? "\n" : ""}${header}\n| --- | --- | --- |\n| ${cell} | ${cell} | ${cell} |`;
  const from = line.to;
  const anchor = from + lead + 2;
  commit(from, from, insert, anchor, anchor + head1.length);
}

function insertDivider() {
  if (!view) return;
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.to);
  const prefix = line.text.trim() ? "\n\n" : "";
  const insert = `${prefix}---\n`;
  commit(line.to, line.to, insert, line.to + insert.length, line.to + insert.length);
}

/* ---------- 列表续行:Enter 延续前缀,空项退出 ---------- */

function continueList(v: EditorView): boolean {
  const { state } = v;
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  const m = line.text.match(/^(\s*)(?:([-*+])\s+|(\d+)([.)])\s+)(\[[ xX]\]\s+)?/);
  if (!m) return false;
  if (main.head < line.from + m[0].length) return false;
  // 空列表项:清除标记,退出列表
  if (line.text.slice(m[0].length).trim() === "") {
    v.dispatch({ changes: { from: line.from, to: line.to }, selection: { anchor: line.from } });
    return true;
  }
  const bullet = m[2] ? `${m[2]} ` : `${m[3]}${m[4]} `;
  const task = m[5] ? "[ ] " : "";
  const insert = `\n${m[1]}${bullet}${task}`;
  v.dispatch({
    changes: [{ from: main.from, to: main.to, insert }],
    selection: { anchor: main.from + insert.length },
    scrollIntoView: true,
  });
  return true;
}

/* ---------- 空白标记:硬换行(¶)与首行缩进(⇥) ---------- */

class BreakMark extends WidgetType {
  override eq() {
    return true;
  }
  override toDOM() {
    const span = document.createElement("span");
    span.className = "ps-ws-mark";
    span.textContent = "¶";
    return span;
  }
}

class IndentMark extends WidgetType {
  override eq() {
    return true;
  }
  override toDOM() {
    const span = document.createElement("span");
    span.className = "ps-ws-mark";
    span.textContent = "⇥";
    return span;
  }
}

function buildWsDecorations(v: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of v.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = v.state.doc.lineAt(pos);
      const text = line.text;
      // 段首全角缩进:逐个标记,数量一目了然
      const indent = text.match(/^　+/);
      if (indent) {
        for (let i = 0; i < indent[0].length; i++) {
          builder.add(line.from + i, line.from + i + 1, Decoration.replace({ widget: new IndentMark() }));
        }
      }
      // 行尾硬换行(两个及以上尾随空格)
      const trail = text.match(/ {2,}$/);
      if (trail) {
        builder.add(line.to - trail[0].length, line.to, Decoration.replace({ widget: new BreakMark() }));
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

class WsMarkerView {
  decorations: DecorationSet;

  constructor(v: EditorView) {
    this.decorations = buildWsDecorations(v);
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged) this.decorations = buildWsDecorations(u.view);
  }
}

/** 空白标记插件(仅 editorWhitespace 开启时装载) */
const wsMarkers = ViewPlugin.fromClass(WsMarkerView, {
  decorations: (v: WsMarkerView) => v.decorations,
});

/* ---------- 写作键位(换行/缩进,随设置重配) ---------- */

/** Tab 添加缩进:结构行(列表/引用/表格/围栏/标题)交给默认缩进(嵌套) */
function indentTab(): boolean {
  if (!view) return false;
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  if (BLOCK_LINE_RE.test(line.text)) return false;
  indentLines();
  return true;
}

/** Shift+Tab 移除缩进:结构行交给默认反缩进 */
function outdentTab(): boolean {
  if (!view) return false;
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  if (BLOCK_LINE_RE.test(line.text)) return false;
  outdentLines();
  return true;
}

function makeWritingExtensions(): Extension[] {
  const exts: Extension[] = [];
  const keys: KeyBinding[] = [];
  const breakKey = app.settings.editorBreakKey ?? "enter";
  const indentKey = app.settings.editorIndentKey ?? "tab";
  if (breakKey === "enter") {
    // 列表续行优先,其余位置按硬换行处理
    keys.push({ key: "Enter", run: (v) => (continueList(v) ? true : (insertBreak(), true)) });
    keys.push({ key: "Mod-Enter", run: () => (insertBreak(), true) });
  } else if (breakKey === "modEnter") {
    keys.push({ key: "Mod-Enter", run: () => (insertBreak(), true) });
  }
  if (indentKey === "tab") {
    keys.push({ key: "Tab", run: indentTab });
    keys.push({ key: "Shift-Tab", run: outdentTab });
    keys.push({ key: "Mod-Shift-i", run: () => (indentLines(), true) });
  } else if (indentKey === "modShiftI") {
    keys.push({ key: "Mod-Shift-i", run: () => (indentLines(), true) });
  }
  if (keys.length) exts.push(keymap.of(keys));
  if (app.settings.editorWhitespace ?? true) exts.push(wsMarkers);
  return exts;
}

const writingComp = new Compartment();

/* ---------- 资产拖入:资产栏图片拖到正文,弹窗确认插入方式与属性 ---------- */

/**
 * 从资产栏拖来的图片(ASSET_MIME 载荷为 content/ 相对路径):
 * drop 时记住落点并打开插入弹窗 —— 用户确认插入方式(Markdown/HTML)与属性后
 * 按落点插入;取消则不插入。落点行空白时就地插入,否则另起一段;
 * 落点在 front-matter 内时移到其后。
 */
const assetDrop = EditorView.domEventHandlers({
  dragover(e) {
    if (!e.dataTransfer?.types.includes(ASSET_MIME)) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    return true;
  },
  drop(e, v) {
    const asset = e.dataTransfer?.getData(ASSET_MIME);
    if (!asset) return false;
    e.preventDefault();
    let pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
    const fmEnd = frontMatterEnd(v.state.doc);
    let at: number;
    let lead: string;
    if (fmEnd !== null && pos < fmEnd) {
      at = fmEnd;
      lead = "\n\n";
    } else {
      const line = v.state.doc.lineAt(pos);
      if (line.text.trim() === "") {
        at = pos;
        lead = "";
      } else {
        at = line.to;
        lead = "\n\n";
      }
    }
    pendingImage = { from: at, to: at, lead };
    imageSource.value = { kind: "asset", path: asset };
    imageModalOpen.value = true;
    return true;
  },
});

/* ---------- 初始化 ---------- */

onMounted(() => {
  view = new EditorView({
    state: EditorState.create({
      doc: editor.content,
      extensions: [
        history(),
        writingComp.of(makeWritingExtensions()),
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              void editor.save();
              return true;
            },
          },
          { key: "Mod-b", run: () => (wrapSelection("**"), true) },
          { key: "Mod-i", run: () => (wrapSelection("*"), true) },
          { key: "Mod-1", run: () => (setHeading(1), true) },
          { key: "Mod-2", run: () => (setHeading(2), true) },
          { key: "Mod-3", run: () => (setHeading(3), true) },
          { key: "Mod-4", run: () => (setHeading(4), true) },
          { key: "Mod-5", run: () => (setHeading(5), true) },
          { key: "Mod-6", run: () => (setHeading(6), true) },
          { key: "Mod-e", run: () => (wrapSelection("`"), true) },
          { key: "Mod-k", run: () => (insertLink(), true) },
          { key: "Mod-Shift-x", run: () => (wrapSelection("~~"), true) },
          { key: "Mod-Shift-c", run: () => (toggleCodeBlock(), true) },
          { key: "Mod-Shift-9", run: () => (toggleQuote(), true) },
          { key: "Mod-Shift-8", run: () => (toggleBullet(), true) },
          { key: "Mod-Shift-7", run: () => (toggleOrdered(), true) },
          { key: "Mod-Shift-t", run: () => (toggleTask(), true) },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        highlightSelectionMatches(),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(plainHighlight),
        assetDrop,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) editor.onInput(u.state.doc.toString());
        }),
      ],
    }),
    parent: host.value!,
  });
  // 注册到右键菜单:编辑器内的右键文本操作直接作用于 CodeMirror 选区
  registerCmView(host.value!, view);
  // 登记到全局 store:侧边栏的全局撤销/重做按钮经 store 驱动编辑器历史
  editor.registerView(view);
});

// 外部写回(新建文档配置头、资产页重命名联动):把 store 的新内容同步进 CodeMirror
watch(
  () => editor.content,
  (next) => {
    if (!editor.externalReplace || !view) return;
    editor.externalReplace = false;
    const cur = view.state.doc.toString();
    if (next !== cur) view.dispatch({ changes: { from: 0, to: cur.length, insert: next } });
  },
);

// 设置变更即时重配写作键位与空白标记
watch(
  () => [
    app.settings.editorBreakKey,
    app.settings.editorIndentKey,
    app.settings.editorWhitespace,
    app.settings.editorIndentWidth,
  ],
  () => {
    view?.dispatch({ effects: writingComp.reconfigure(makeWritingExtensions()) });
  },
);

// 打开新文档时整体替换(不触发自动保存回路)
watch(
  () => editor.activePath,
  () => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== editor.content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: editor.content } });
    }
  },
);

onBeforeUnmount(() => {
  if (host.value) unregisterCmView(host.value);
  editor.unregisterView(view!);
  view?.destroy();
  view = null;
});

defineExpose({
  scroller: () => view?.scrollDOM ?? null,
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface">
    <!-- 格式工具栏:按钮溢出时自动换行,不出现横向滚动条 -->
    <div class="flex shrink-0 flex-wrap content-start items-center gap-0.5 border-b border-line px-2 py-[5px]">
      <button class="tb-btn tb-text" :title="t('editor.toolbar.heading', { n: 1, mod })" @click="setHeading(1)">H1</button>
      <button class="tb-btn tb-text" :title="t('editor.toolbar.heading', { n: 2, mod })" @click="setHeading(2)">H2</button>
      <button class="tb-btn tb-text" :title="t('editor.toolbar.heading', { n: 3, mod })" @click="setHeading(3)">H3</button>
      <span class="tb-sep" />
      <button class="tb-btn tb-text font-bold" :title="t('editor.toolbar.bold', { mod })" @click="wrapSelection('**')">B</button>
      <button class="tb-btn tb-text italic" :title="t('editor.toolbar.italic', { mod })" @click="wrapSelection('*')">I</button>
      <button class="tb-btn tb-text line-through" :title="t('editor.toolbar.strikethrough', { mod })" @click="wrapSelection('~~')">S</button>
      <button class="tb-btn" :title="t('editor.toolbar.inlineCode', { mod })" @click="wrapSelection('`')">
        <AppIcon name="code" :size="15" />
      </button>
      <span class="tb-sep" />
      <button class="tb-btn" :title="t('editor.toolbar.quote', { mod })" @click="toggleQuote">
        <AppIcon name="quote" :size="15" />
      </button>
      <button class="tb-btn" :title="t('editor.toolbar.bulletList', { mod })" @click="toggleBullet">
        <AppIcon name="listBullet" :size="15" />
      </button>
      <button class="tb-btn" :title="t('editor.toolbar.orderedList', { mod })" @click="toggleOrdered">
        <AppIcon name="listOrdered" :size="15" />
      </button>
      <button class="tb-btn" :title="t('editor.toolbar.taskList', { mod })" @click="toggleTask">
        <AppIcon name="checkSquare" :size="15" />
      </button>
      <span class="tb-sep" />
      <button class="tb-btn" :title="t('editor.toolbar.link', { mod })" @click="insertLink">
        <AppIcon name="link" :size="15" />
      </button>
      <button class="tb-btn" :title="t('editor.toolbar.image')" @click="insertImage">
        <AppIcon name="image" :size="15" />
      </button>
      <button class="tb-btn" :title="t('editor.toolbar.imageFigure')" @click="insertImageFigure">
        <AppIcon name="maximize" :size="15" />
      </button>
      <button class="tb-btn" :title="t('editor.toolbar.imgAlignLeft')" @click="alignImage('left')">
        <AppIcon name="imgAlignLeft" :size="15" />
      </button>
      <button class="tb-btn" :title="t('editor.toolbar.imgAlignCenter')" @click="alignImage('center')">
        <AppIcon name="imgAlignCenter" :size="15" />
      </button>
      <button class="tb-btn" :title="t('editor.toolbar.imgAlignRight')" @click="alignImage('right')">
        <AppIcon name="imgAlignRight" :size="15" />
      </button>
      <button class="tb-btn" :title="t('editor.toolbar.codeBlock', { mod })" @click="toggleCodeBlock">
        <AppIcon name="squareCode" :size="15" />
      </button>
      <span class="tb-sep" />
      <button class="tb-btn" :title="t('editor.toolbar.table')" @click="insertTable">
        <AppIcon name="table" :size="15" />
      </button>
      <button class="tb-btn" :title="t('editor.toolbar.divider')" @click="insertDivider">
        <AppIcon name="minus" :size="15" />
      </button>
      <span class="tb-sep" />
      <button class="tb-btn" :title="t('editor.toolbar.alignLeft')" @click="alignText('left')">
        <AppIcon name="alignLeft" :size="15" />
      </button>
      <button class="tb-btn" :title="t('editor.toolbar.alignCenter')" @click="alignText('center')">
        <AppIcon name="alignCenter" :size="15" />
      </button>
      <button class="tb-btn" :title="t('editor.toolbar.alignRight')" @click="alignText('right')">
        <AppIcon name="alignRight" :size="15" />
      </button>
      <span class="tb-sep" />
      <button class="tb-btn" :title="indentTitle" @click="indentLines">
        <AppIcon name="indent" :size="15" />
      </button>
      <button class="tb-btn" :title="breakTitle" @click="insertBreak">
        <AppIcon name="wrapText" :size="15" />
      </button>
      <span class="tb-sep" />
      <button class="tb-btn" :title="t('editor.toolbar.frontmatter')" @click="openFmEditor()">
        <AppIcon name="frontmatter" :size="15" />
      </button>
    </div>

    <div ref="host" class="min-h-0 flex-1 overflow-hidden" />

    <!-- 配置头可视化编辑:表单控件替代手写字段,确认后就地写回 front-matter -->
    <FrontMatterModal
      :open="fmOpen"
      :doc-path="editor.activePath ?? ''"
      :initial="fmInitial"
      :blog-home="blogHomeOptions"
      @confirm="writeFrontMatter"
      @cancel="fmOpen = false"
    />

    <!-- 插入图片配置:方式(Markdown/HTML 嵌入)、站点内路径与 HTML 对齐/尺寸/class -->
    <ImageInsertModal :open="imageModalOpen" :source="imageSource" @confirm="onImageInsertConfirm" @cancel="onImageInsertCancel" />
  </div>
</template>

<style scoped>
.tb-btn {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 4px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-ink-3);
  font-size: calc(12px * var(--ui-font-scale));
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color var(--duration-base) var(--ease-plain),
    color var(--duration-base) var(--ease-plain);
}
.tb-btn:hover {
  background: var(--color-surface-2);
  color: var(--color-ink);
}
.tb-text {
  font-family: var(--font-sans);
}
.tb-sep {
  flex-shrink: 0;
  width: 1px;
  height: 14px;
  margin: 0 4px;
  background: var(--color-line);
}
</style>

<style>
/* 空白标记(CodeMirror 内容在 scoped 之外,用全局样式) */
.ps-ws-mark {
  color: var(--color-ink-3);
  opacity: 0.55;
  font-size: 0.85em;
  user-select: none;
  pointer-events: none;
}
</style>
