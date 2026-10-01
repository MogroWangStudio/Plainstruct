/** 前后端共享的数据契约 -- 与 Rust 侧 serde 结构一一对应 */

export type Platform = "windows" | "macos" | "browser";
export type Locale = "zh-CN" | "en-US";
export type ThemeSource = "builtin" | "custom";
/** 站点类型:文档站 / 博客站,决定可选主题与主页形态 */
export type SiteType = "docs" | "blog";
/** 软件主题:浅色 / 暗色 / 素笺 / 青瓷 / 深海 / 紫檀 / 跟随系统 */
export type AppTheme = "light" | "dark" | "sepia" | "mint" | "ocean" | "plum" | "system";
/** 界面字体模式:系统默认 / 衬线 / 等宽 / 自定义 font-family */
export type UiFontMode = "system" | "serif" | "mono" | "custom";
/** 编辑器字体模式:默认等宽 / 跟随界面 / 衬线 / 自定义 font-family */
export type EditorFontMode = "default" | "ui" | "serif" | "custom";
/** 硬换行触发键 */
export type EditorBreakKey = "enter" | "modEnter" | "none";
/** 首行缩进触发键 */
export type EditorIndentKey = "tab" | "modShiftI" | "none";

/** 发布成功彩带程度 */
export type ConfettiLevel = "off" | "light" | "standard" | "grand";

export interface AppSettings {
  locale: Locale;
  autosave: boolean;
  theme?: AppTheme;
  uiFont?: UiFontMode;
  uiFontCustom?: string;
  /** 界面字号缩放系数(0.85–1.3,默认 1);旧版本为档位枚举,读取时归一 */
  uiFontSize?: number;
  /** 界面基础字重(400–600,默认 400);旧版本为档位枚举,读取时归一 */
  uiFontWeight?: number;
  editorFont?: EditorFontMode;
  editorFontCustom?: string;
  /** 空白标记显示:硬换行(¶)与首行缩进(⇥)的可见标记 */
  editorWhitespace?: boolean;
  /** 硬换行触发键,默认 Enter */
  editorBreakKey?: EditorBreakKey;
  /** 首行缩进触发键,默认 Tab */
  editorIndentKey?: EditorIndentKey;
  /** 每次缩进添加的全角空格数量(中文常用 2),默认 2 */
  editorIndentWidth?: number;
  /** 发布成功彩带程度,默认 standard(标准) */
  confetti?: ConfettiLevel;
}

export interface RecentSite {
  name: string;
  path: string;
  openedAt: number;
}

export interface Bootstrap {
  version: string;
  platform: Platform;
  /** 当前生效的数据目录(自定义或默认) */
  appDataDir: string;
  /** 用户自定义的数据目录(null = 使用默认位置) */
  customDataDir: string | null;
  settings: AppSettings;
  recentSites: RecentSite[];
  /** 已下载待安装的更新(存在时设置页显示「重启并更新」) */
  pendingUpdate: PendingUpdate | null;
}

/** 已下载待安装的更新任务 */
export interface PendingUpdate {
  version: string;
  assetName: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
}

/** 自动更新包下载进度(name/version 用于下载中展示包名与目标版本) */
export interface UpdateProgress {
  received: number;
  total: number | null;
  name?: string;
  version?: string;
}

/** 更新包下载结果:paused=true 表示因暂停而中途返回(断点已保留) */
export interface UpdateDownloadResult {
  version: string;
  assetName: string;
  paused: boolean;
}

export interface SiteThemeRef {
  id: string;
  source: ThemeSource;
  config: Record<string, string | number | boolean>;
}

export interface SiteConfig {
  name: string;
  description?: string;
  /** 站点内 logo:.plainstruct/assets/ 内的文件名,受主题展示配置影响 */
  logo?: string;
  /** 站点外图标(favicon):浏览器标签页使用;未设置时回退站点内 logo */
  favicon?: string;
  locale?: string; // 站点语言:生成页面的 <html lang>
  titleFormat?: string; // 浏览器标题格式,如 "{page} · {site}"
  siteType?: SiteType; // 站点类型,缺省 docs(兼容旧站点)
  theme: SiteThemeRef;
}

export interface TreeNode {
  name: string;
  path: string; // 相对 content/,POSIX 风格,如 "guide/setup.md"
  type: "dir" | "file";
  /** 文件字节数(仅文件节点携带) */
  size?: number;
  children?: TreeNode[];
}

export type ThemeFieldType = "color" | "text" | "number" | "select" | "boolean" | "navlist";

export interface ThemeField {
  key: string;
  label: string;
  type: ThemeFieldType;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** 可选:仅当另一字段等于 equals,或落在 oneOf 之一时显示
   *  (如自定义字体依赖 bodyFont=custom;顶栏变形宽度对「药丸 / 圆角矩形」两种形态都可见) */
  visibleIf?: {
    key: string;
    equals?: string | number | boolean;
    oneOf?: (string | number | boolean)[];
  };
}

export interface ThemeMeta {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  config: ThemeField[];
  /** 主题适用的站点类型,缺省 docs(兼容旧自定义主题);theme.json 内写作 "type" */
  siteType?: SiteType;
  source: ThemeSource;
}

export interface OutputFile {
  path: string; // 相对 build/,POSIX 风格
  content: string;
}

export interface CopyItem {
  src: string; // 相对站点根
  dest: string; // 相对 build/(构建页面的资源引用根)
}

export interface GithubConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  autoCreate: boolean;
}

export interface VerifyResult {
  ok: boolean;
  user?: string;
  repoExists?: boolean;
  pagesEnabled?: boolean;
  message?: string;
}

export interface SyncResult {
  commitSha: string;
  pagesUrl: string;
}

/** 发布前预检:提醒而非阻断 */
export interface PublishPreflight {
  /** content 在最近构建后有修改,本地构建已过期(建议重新构建) */
  buildStale: boolean;
  /** 云端分支与本站点上次发布的记录不一致(发布将覆盖云端外部更改) */
  remoteDirty: boolean;
}

/** GitHub Pages 部署状态(针对本次发布提交) */
export interface PagesBuildStatus {
  /** 本次提交已构建完成,可以打开站点 */
  ready: boolean;
  /** 部署失败 */
  errored: boolean;
  /** 原始构建状态(built / building / errored / none / http-xxx) */
  status: string;
}

export interface SyncProgress {
  done: number;
  total: number;
  message: string;
}

/** 发布运行日志条目(后端发布流程逐阶段推送) */
export interface SyncLogEntry {
  level: "info" | "error" | "success";
  message: string;
  /** 毫秒时间戳 */
  time: number;
}

export interface BuildWarning {
  source: string; // 源文档路径
  link: string; // 原始链接
  message: string;
}

export interface BuildReport {
  pages: number;
  assets: number;
  warnings: BuildWarning[];
  durationMs: number;
  /** 构建产物(build/)总占用字节数 */
  totalSize: number;
}
