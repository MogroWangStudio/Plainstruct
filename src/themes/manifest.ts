/** 内置主题清单 -- Vite ?raw 加载,与自定义主题(ZIP)同一结构 */
import type { ThemeBundle } from "@/lib/theme-engine";
import type { ThemeMeta } from "@/ipc/types";
import lightMeta from "./plain-light/theme.json";
import lightLayout from "./plain-light/templates/layout.hbs?raw";
import lightPage from "./plain-light/templates/page.hbs?raw";
import lightNav from "./plain-light/partials/nav.hbs?raw";
import lightCss from "./plain-light/assets/style.css?raw";
import darkMeta from "./plain-dark/theme.json";
import darkLayout from "./plain-dark/templates/layout.hbs?raw";
import darkPage from "./plain-dark/templates/page.hbs?raw";
import darkNav from "./plain-dark/partials/nav.hbs?raw";
import darkCss from "./plain-dark/assets/style.css?raw";
import inkMeta from "./ink/theme.json";
import inkLayout from "./ink/templates/layout.hbs?raw";
import inkPage from "./ink/templates/page.hbs?raw";
import inkNav from "./ink/partials/nav.hbs?raw";
import inkCss from "./ink/assets/style.css?raw";
import terminalMeta from "./terminal/theme.json";
import terminalLayout from "./terminal/templates/layout.hbs?raw";
import terminalPage from "./terminal/templates/page.hbs?raw";
import terminalNav from "./terminal/partials/nav.hbs?raw";
import terminalCss from "./terminal/assets/style.css?raw";
import galleryMeta from "./gallery/theme.json";
import galleryLayout from "./gallery/templates/layout.hbs?raw";
import galleryPage from "./gallery/templates/page.hbs?raw";
import galleryNav from "./gallery/partials/nav.hbs?raw";
import galleryCss from "./gallery/assets/style.css?raw";
import blogLightMeta from "./blog-light/theme.json";
import blogLightLayout from "./blog-light/templates/layout.hbs?raw";
import blogLightPage from "./blog-light/templates/page.hbs?raw";
import blogLightPostEntry from "./blog-light/partials/post-entry.hbs?raw";
import blogLightCss from "./blog-light/assets/style.css?raw";
import blogDarkMeta from "./blog-dark/theme.json";
import blogDarkLayout from "./blog-dark/templates/layout.hbs?raw";
import blogDarkPage from "./blog-dark/templates/page.hbs?raw";
import blogDarkPostEntry from "./blog-dark/partials/post-entry.hbs?raw";
import blogDarkCss from "./blog-dark/assets/style.css?raw";
import magazineMeta from "./magazine/theme.json";
import magazineLayout from "./magazine/templates/layout.hbs?raw";
import magazinePage from "./magazine/templates/page.hbs?raw";
import magazinePostEntry from "./magazine/partials/post-entry.hbs?raw";
import magazineCss from "./magazine/assets/style.css?raw";
import devlogMeta from "./devlog/theme.json";
import devlogLayout from "./devlog/templates/layout.hbs?raw";
import devlogPage from "./devlog/templates/page.hbs?raw";
import devlogPostEntry from "./devlog/partials/post-entry.hbs?raw";
import devlogCss from "./devlog/assets/style.css?raw";
import minimalMeta from "./minimal/theme.json";
import minimalLayout from "./minimal/templates/layout.hbs?raw";
import minimalPage from "./minimal/templates/page.hbs?raw";
import minimalPostEntry from "./minimal/partials/post-entry.hbs?raw";
import minimalCss from "./minimal/assets/style.css?raw";

/** theme.json 内写作 "type",元数据契约字段为 siteType,导入时统一映射 */
function toMeta(meta: Record<string, unknown>): ThemeMeta {
  const { type, ...rest } = meta;
  return {
    ...(rest as unknown as ThemeMeta),
    siteType: type === "blog" ? "blog" : type === "docs" ? "docs" : undefined,
    source: "builtin",
  };
}

export const builtinThemes: ThemeBundle[] = [
  {
    meta: toMeta(lightMeta),
    files: {
      "theme.json": JSON.stringify(lightMeta, null, 2),
      "templates/layout.hbs": lightLayout,
      "templates/page.hbs": lightPage,
      "partials/nav.hbs": lightNav,
      "assets/style.css": lightCss,
    },
  },
  {
    meta: toMeta(darkMeta),
    files: {
      "theme.json": JSON.stringify(darkMeta, null, 2),
      "templates/layout.hbs": darkLayout,
      "templates/page.hbs": darkPage,
      "partials/nav.hbs": darkNav,
      "assets/style.css": darkCss,
    },
  },
  {
    meta: toMeta(inkMeta),
    files: {
      "theme.json": JSON.stringify(inkMeta, null, 2),
      "templates/layout.hbs": inkLayout,
      "templates/page.hbs": inkPage,
      "partials/nav.hbs": inkNav,
      "assets/style.css": inkCss,
    },
  },
  {
    meta: toMeta(terminalMeta),
    files: {
      "theme.json": JSON.stringify(terminalMeta, null, 2),
      "templates/layout.hbs": terminalLayout,
      "templates/page.hbs": terminalPage,
      "partials/nav.hbs": terminalNav,
      "assets/style.css": terminalCss,
    },
  },
  {
    meta: toMeta(galleryMeta),
    files: {
      "theme.json": JSON.stringify(galleryMeta, null, 2),
      "templates/layout.hbs": galleryLayout,
      "templates/page.hbs": galleryPage,
      "partials/nav.hbs": galleryNav,
      "assets/style.css": galleryCss,
    },
  },
  {
    meta: toMeta(blogLightMeta),
    files: {
      "theme.json": JSON.stringify(blogLightMeta, null, 2),
      "templates/layout.hbs": blogLightLayout,
      "templates/page.hbs": blogLightPage,
      "partials/post-entry.hbs": blogLightPostEntry,
      "assets/style.css": blogLightCss,
    },
  },
  {
    meta: toMeta(blogDarkMeta),
    files: {
      "theme.json": JSON.stringify(blogDarkMeta, null, 2),
      "templates/layout.hbs": blogDarkLayout,
      "templates/page.hbs": blogDarkPage,
      "partials/post-entry.hbs": blogDarkPostEntry,
      "assets/style.css": blogDarkCss,
    },
  },
  {
    meta: toMeta(magazineMeta),
    files: {
      "theme.json": JSON.stringify(magazineMeta, null, 2),
      "templates/layout.hbs": magazineLayout,
      "templates/page.hbs": magazinePage,
      "partials/post-entry.hbs": magazinePostEntry,
      "assets/style.css": magazineCss,
    },
  },
  {
    meta: toMeta(devlogMeta),
    files: {
      "theme.json": JSON.stringify(devlogMeta, null, 2),
      "templates/layout.hbs": devlogLayout,
      "templates/page.hbs": devlogPage,
      "partials/post-entry.hbs": devlogPostEntry,
      "assets/style.css": devlogCss,
    },
  },
  {
    meta: toMeta(minimalMeta),
    files: {
      "theme.json": JSON.stringify(minimalMeta, null, 2),
      "templates/layout.hbs": minimalLayout,
      "templates/page.hbs": minimalPage,
      "partials/post-entry.hbs": minimalPostEntry,
      "assets/style.css": minimalCss,
    },
  },
];

export function getBuiltinTheme(id: string): ThemeBundle | undefined {
  return builtinThemes.find((t) => t.meta.id === id);
}
