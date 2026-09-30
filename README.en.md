<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo-full-dark.svg">
    <img src="public/logo-full.svg" alt="Plainstruct" width="420">
  </picture>
</p>

# Plainstruct

A local-first static site creator for both documentation and blogs. Write Markdown in folders, build with one click, preview locally, and publish to GitHub Pages - no terminal, no backend.

[中文](./README.md) · [Changelog](./changelog.md)

## Features

- **Two site types** - choose **Documentation** (sidebar navigation, for wikis and product manuals) or **Blog** (the home page is a date-sorted post stream, article pages get a table of contents) when creating a site; the type can be switched in site settings later, and the theme list is filtered by type automatically
- **Content management** - tree management of folders and Markdown documents: create (with custom title) / rename / delete (to system trash) / import; drag & drop moves with an insertion indicator (row edge = move next to that row's directory, folder middle = move into the folder), and dragging to a row's top/bottom edge **manually reorders** (reorder within a directory or insert across directories, multi-selection moves as a group) - the order is saved in `.plainstruct/order.json`, and the built site's navigation, directory pages and prev/next links all follow it; multi-select via Shift range and Ctrl/⌘ toggle, batch move by drag & drop, folders auto-expand on hover; the Home entry is pinned to the top of the tree, and a dedicated **asset pane** at the bottom lists images from the site's `asset/` folder (legacy `images/` recognized as well; never enters the site output) with card & list views — drag any image into the body to insert a Markdown reference; files show type icons (Markdown document / image); a document's right-click menu opens the visual front-matter editor directly; dedicated right-click menus for the file tree (new / import / rename / delete) and the editor & inputs (cut / copy / paste / select all)
- **Live editing** - CodeMirror 6 editor side-by-side with rendered preview, proportional scroll sync, autosave; a formatting toolbar for headings, bold, italic, strikethrough, quote, lists, link, image, table, code blocks, first-line indent and hard line break, plus **text and image alignment buttons** (left/center/right; images are wrapped in an HTML alignment container whose `align` attribute is explicitly honored by every theme — pick an image first to wrap it, or insert a template); **guided image insertion**: picked images are copied into the site's `content/asset/` folder (pre-created for new sites; duplicates get a numbered suffix) and a relative reference is inserted at the cursor, adjusted for the document's location (`../images/…` inside subfolders); when the cursor sits inside the front-matter the insert lands after it, so the metadata block stays intact; full shortcuts: `⌘/Ctrl+1..6` headings, `⌘B` bold, `⌘I` italic, `⌘E` inline code, `⌘K` link, `⌘⇧X` strikethrough, `⌘⇧C` code block, `⌘⇧7/8/9` ordered/bullet/quote, `⌘⇧T` task list, with `Enter` defaulting to a hard break (Markdown trailing double space; works on empty lines too; list lines auto-continue) and `Tab` to **adding** a first-line indent (`Shift+Tab` removes it; the indent width is configurable — 2 full-width spaces is common for Chinese); hard breaks (¶) and first-line indents (⇥) support **visible marks**, and both the keys and marks are configurable in Settings; an **edit front-matter** button opens a visual form (title/description inputs, a date picker and cover-image suggestions from the site's asset folder or one-click local import); saving writes the values back to the front-matter — empty fields are omitted and custom fields you wrote by hand are kept; the **new-document dialog embeds these front-matter fields** so a post can be fully set up at creation; the preview shares the exact rendering pipeline with the build - what you see is what you ship
- **Asset management** - the asset pane (bottom of the tree) and the Assets view manage images in the site's `asset/` folder (legacy `images/` recognized): a card grid on the left and a width-adjustable details pane on the right (large preview plus the list of referencing documents, click to jump straight to one); renaming rewrites the references across documents automatically (documents with unsaved edits are skipped), deletion asks for confirmation and warns about references that would break
- **Site settings** - name, description, logo, site language (written to `<html lang>`, preset or custom locale codes) and browser title format (`{page} · {site}` placeholders); the site logo also serves as the favicon across all pages
- **One-click build** - output is plain static HTML; every internal link and asset is **relative**, so the site works on GitHub Pages project subpaths, custom domains, or opened from disk; site images live in the `content/asset/` folder (images you insert are copied there automatically; older sites keep using `images/`) and ship as the root `asset/` folder, with Markdown references rewritten relative to each page; folders without an index.md automatically get a generated directory listing page; a full link check runs at build time and broken links are listed in the report; the standalone preview window remembers its position & size and reloads in place on rebuild; saving docs or changing the theme / theme config triggers an automatic debounced rebuild, so build previews and output stay up to date
- **Theme system** - ten built-in themes: documentation sites get "Plain · Light", "Plain · Dark" (sidebar layout), "Ink" (serif editorial), "Terminal" (command line) and "Gallery" (modern cards); blogs get "Journal · Light" and "Journal · Dark" (card-style post stream), "Magazine" (serif masthead), "Devlog" (monospace dark) and "Blank" (minimal centered); all with per-page count, pagination and per-post TOC; posts without a cover image get a document-icon placeholder cover; blog themes offer a **customizable top-right nav** (pick which articles/folders to show, capped by a configurable maximum so the bar never overflows) plus three layout settings — **card columns, cover height and a top bar width decoupled from the content width** — and brand & motion settings: independent Logo/title toggles, Logo width/height percentage and corner radius, per-element **hover feedback** for logo/title/navigation (dim / grow / accent / underline / tint), card shadows for rest and hover (presets none/light/medium/deep, or **fully custom** X/Y offset, blur, spread and opacity) plus card **hover feedback** presets (none / lift / sink / grow / shrink / fade / tilt) with **adjustable transition easing and duration** (standard / ease-out / ease-in / linear / springy, or a custom cubic-bezier and 80–800ms), and a **page-loading animation** (spinner / dots / progress bar, off by default); every theme supports **body font switching** (system / serif / monospace / custom font-family); documents can display their front-matter date (toggleable per theme); collapsible sidebar table of contents with cross-page memory, 9 page transition animation presets, optional "Created with Plainstruct" footer credit; visual settings panel (color / number / select / toggle; numbers support **double-click editing** with a one-click **reset** when changed from default); theme editor with code editing and a live preview that can browse pages by clicking in-site links; themes import & export as ZIP
- **App appearance** - light / dark / follow-system app themes (dark is a warm-black palette), UI and editor fonts selectable between system default / serif / monospace / custom, plus **interface text size** (small / default / large / extra large, whole-UI scaling) and **interface text weight** (regular / medium / semibold), applied instantly
- **GitHub Pages publishing** - pushes the build as a **single atomic commit** via the GitHub API using a personal access token; creates repo / branch / Pages automatically - no Git required; failures surface the exact reason returned by GitHub; a brief confetti burst celebrates a successful publish (intensity configurable in Settings: light / standard / grand, or off), the Pages build is watched automatically — the globe "View site" button lights up with a toast once the build finishes, the centered publish button plays a non-linear loading animation and turns into "Republish"
- **Update check** - one-click check in Settings against the latest GitHub Release, showing the new version, release notes and publish time; when a new version is found it can be downloaded in one click (pause and resume supported), then "Restart & Update" hands over to the update wizard - it closes the app, installs the new build over the old one and relaunches automatically
- **Self-healing startup** - startup failures recover automatically in steps: a reload first, then clearing the browser cache and reloading, and only then a diagnostic panel for manual reporting - white screens caused by corrupted UI-layer data mostly resolve on their own; Settings → Data also offers a one-click "Clear browser cache" first aid
- **Local-first** - all data lives inside the folder you choose; backup = copy; no backend, no telemetry
- **Bilingual UI** - switch between Chinese and English from the title bar

## Design

Plain (素) structure (构): gray-white palette, a single ink accent, system font stack, 4px base grid, 8px radius, one easing curve `cubic-bezier(0.23, 1, 0.32, 1)`. No gradients, no glows, no decoration for its own sake - hierarchy comes from type size, weight and whitespace. Form controls are custom-drawn: dropdowns open a floating panel with arrow-key selection and a check mark on the active option; sliders use a 4px track with an ink progress fill and the thumb scales up with a soft ring on press; checkboxes fill with ink and the check mark pops in; keyboard focus rings land on the control itself.

## Getting Started

### Users

Download an installer for your platform from [GitHub Releases](https://github.com/MogroWang/Plainstruct/releases):

- **Windows x64** - portable zip only (`Plainstruct-<version>-Windows-x64-Portable.zip`): unzip and run `plainstruct.exe`; auto-update overwrites the app folder with the same package
- **macOS (Apple Silicon)** - dmg disk image (drag into Applications) or zip archive (unzip and move into Applications), both bundling the repair script. The app is ad-hoc signed and not notarized; if macOS says it is "damaged", double-click **`损坏修复.command` (Repair Damaged)** inside the package and enter your password (only to remove the quarantine flag), or run `sudo xattr -r -d com.apple.quarantine /Applications/Plainstruct.app` in a terminal. Plainstruct is open source — this fix only clears Gatekeeper's quarantine flag on an un-notarized app and changes nothing inside it

First run:

1. "New site" - pick **Documentation** or **Blog**, a name, and an empty folder
2. Create documents in the tree and start writing (declare title / description / date with a `---` front-matter block; drag a document to a row's top/bottom edge to reorder)
3. Build on the Build page and preview the final site
4. Pick or customize a theme on the Theme page (the list is filtered by site type)
5. Fill in your GitHub username / repo / token on the Publish page and publish

### Access token

Create one at [GitHub Settings -> Developer settings -> Personal access tokens](https://github.com/settings/tokens) with the `repo` scope. The token is stored only in your site folder at `.plainstruct/github.json` and never uploaded anywhere; avoid shared computers.

## Site folder layout

```
<your site>/
├── content/            # documents & assets (editable with any tool)
│   ├── index.md        # site home
│   └── asset/          # site image assets (inserted images are copied here)
│   └── guide/
│       ├── index.md    # folder landing page (nav folder title comes from its front-matter title)
│       └── setup.md
├── .plainstruct/       # Plainstruct metadata
│   ├── site.json       # site config (name/description/logo/theme/language)
│   ├── github.json     # publish config (contains the token - keep private)
│   ├── order.json      # manual document order (generated by dragging the tree)
│   └── themes/         # custom themes
└── build/              # build output (safe to delete & rebuild)
```

**Path mapping**: `index.md -> index.html`, `foo.md -> foo.html`, `foo/index.md -> foo/index.html`. Link between documents with plain relative `.md` paths - they are rewritten to `.html` at build time. Folders without an `index.md` get an auto-generated directory listing page (`<folder>/index.html`) at build time, listing all documents and subfolders; folder titles in the navigation and directory pages are clickable links.

**Front-matter** fields: `title`, `description`, `date` and `cover` (an image path relative to the document, or an external URL — shown on blog post streams) (e.g. `2026-09-26`, shown as-is, toggleable per theme; blog post streams are sorted by date descending, undated posts come last). Document ordering does not rely on front-matter: drag a document to a row's top/bottom edge in the tree to arrange it manually - the order is saved in `.plainstruct/order.json` (the legacy front-matter `order` field no longer affects ordering).

On a **blog site** the home page is the post stream: posts render as **cards** (cover image, title, date and subtitle — set a cover with `cover:` in the front-matter); new documents offer an optional subtitle field (written to the front-matter `description`); the per-page count is configurable in the theme settings (3–30 posts), and overflow automatically generates `page/N/` pages with numbered and prev/next navigation; article pages get a right-hand table of contents (extracted from h2/h3, highlighting the current section on scroll); if a root `index.md` exists its body renders above the stream and can serve as an announcement area. The top-right nav shows every top-level article and folder by default; theme settings can switch it to **custom selection** (tick the items to show, in tree order), always capped by a "max items" setting (1-12, default 6) so the bar never overflows. In the editor's live preview, clicking a button or a link the preview cannot render (such as a pagination page) shows a notice to build the site for the full experience.

## Theme development

A theme is a ZIP package:

```
theme.zip
├── theme.json          # metadata + settings-panel schema (required)
├── templates/
│   ├── layout.hbs      # full page layout (required)
│   └── page.hbs        # content area template (optional; defaults to raw content)
├── partials/           # Handlebars partials, registered by filename (optional)
└── assets/             # styles/scripts, referenced via {{asset}}
```

### theme.json

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "version": "1.0.0",
  "author": "you",
  "description": "A theme",
  "type": "docs",
  "config": [
    { "key": "accentColor", "label": "Accent", "type": "color", "default": "#333333" },
    { "key": "sidebarWidth", "label": "Sidebar width", "type": "number", "default": 260, "min": 200, "max": 360, "step": 10 },
    { "key": "bodyFont", "label": "Body font", "type": "select", "default": "system", "options": ["system", "serif"] },
    { "key": "showDescription", "label": "Show description", "type": "boolean", "default": true }
  ]
}
```

Field types: `color` / `text` / `number` / `select` / `boolean`. The `config` array drives the visual settings panel automatically. `type` declares which site type the theme serves (`docs` / `blog`, default `docs`); the theme list is filtered by the current site's type.

### Template context

Available in `layout.hbs` and `page.hbs`:

```handlebars
{{site.name}} {{site.description}} {{site.logo}}      {{!-- site info; logo is a page-relative URL --}}
{{page.title}} {{page.description}} {{page.date}}     {{!-- current document; date from front-matter --}}
{{{page.content}}}                                      {{!-- triple braces: rendered HTML --}}
{{page.url}} {{page.relPrefix}} {{page.isHome}}       {{!-- output path / relative-root prefix / home flag --}}
{{#each page.toc}} {{this.level}} {{this.text}} {{this.id}} {{/each}}   {{!-- per-page TOC (blog sites) --}}
{{#each nav}} {{this.title}} {{this.url}} {{this.current}} {{this.children}} {{/each}}
{{#each posts}} {{this.title}} {{this.url}} {{this.date}} {{this.description}} {{/each}}  {{!-- blog post stream --}}
{{prev.title}} {{prev.url}} {{next.title}} {{next.url}}
{{config.accentColor}}                                  {{!-- theme settings values --}}
{{asset "style.css"}}                                   {{!-- asset URL, made relative per page depth --}}
```

Built-in helpers: `asset`, `eq`. Files under `partials/*.hbs` are registered by filename (`partials/nav.hbs` -> `{{> nav}}`); recursive partials are supported.

On the Theme page you can duplicate a built-in theme, edit templates & styles with live preview, and export a ZIP to share; others simply import the ZIP.

## Development

Requirements: Node 20+ and Rust; on Windows [VS Build Tools](https://visualstudio.microsoft.com/downloads/) with the C++ workload, on macOS the Xcode Command Line Tools (`xcode-select --install`).

```bash
npm install          # frontend deps
npm run dev          # browser-only dev (built-in mock site, no Rust needed)
npm run tauri dev    # full desktop app dev
npm run check        # vue-tsc type check
npm run build        # type check + production frontend build
cargo check          # Rust compile check (in src-tauri/)

npm run icons                          # generate app icons from icon.png
npm run windows:portable               # Windows x64 portable build -> release/Plainstruct_<version>_Windows_x64_Portable.zip
npm run tauri -- build                 # platform artifacts (dmg / app)
```

### Architecture

- **Frontend**: Vue 3 + TypeScript + Vite + Pinia + Tailwind CSS 4 (custom Plainstruct tokens); CodeMirror 6 editor; markdown-it + highlight.js rendering; Handlebars templates
- **Desktop**: Tauri 2 (Rust). File IO, ZIP handling and the GitHub API live in Rust commands; a `site://` custom protocol serves the site folder directly so the build preview matches the published output exactly
- **No backend**: app state lives in a `data/` folder next to the executable (portable — data travels with the app; falls back to the system app-data directory when that location is not writable); site data lives entirely in the site folder

## Credits

Plainstruct by MogroWang Studio. The theme template interface and ZIP format are free for third-party extensions.
