<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo-full-dark.svg">
    <img src="public/logo-full.svg" alt="Plainstruct" width="420">
  </picture>
</p>

<h1 align="center">Plainstruct 素构</h1>

<p align="center">A local-first static site creator, equally at home with docs and blogs.</p>
<p align="center">Write Markdown locally, build with one click, preview, and publish to GitHub Pages.</p>

[中文](./README.md) · [Changelog](./changelog.md)

## Features

### Writing & content

- **Two site types** — pick **Documentation** (sidebar navigation, great for wikis and product manuals) or **Blog** (the home page is a date-sorted post stream) when creating a site; you can switch the type later in site settings.
- **File tree** — manage folders and Markdown documents in one tree: create, rename, delete (to the system trash) and import; drag a document onto a row's top/bottom edge to reorder it manually — the order drives the whole site (navigation, directory pages and prev/next links), and multi-select with batch moves is supported.
- **Drag-in internal links** — drag a document or folder from the file tree into the editor to insert an internal link pointing to that page (front-matter title is preferred as the link text); builds and previews resolve it to the live page address, so visitors can click through.
- **Writing experience** — a side-by-side editor and live preview with autosave; a formatting toolbar plus full keyboard shortcuts (headings, bold, lists, tables, links, code blocks and more); `⌘/Ctrl+F` find & replace with regex and case-sensitivity toggles.
- **Visual front-matter** — set the title, description, date, cover, author, AIGC declaration and tags through a form instead of hand-writing front-matter; the new-document dialog fills it all in one go.
- **Article tags** — add `tags` in the front-matter and they appear as pills under each post card, with per-tag colors in the theme settings; blog folder pages automatically get a tag filter bar — one click to filter.
- **Asset management** — an asset pane at the bottom of the tree plus a dedicated Assets view for the site's images: drag files in from Finder/Explorer to import, renaming rewrites all references automatically, and marquee-select, batch move and delete are supported.

### Build & appearance

- **One-click build** — output is plain static HTML with fully relative links and assets, so the site works on GitHub Pages subpaths, custom domains, or opened straight from disk; a full link check runs at build time and broken links are listed in the report.
- **Standalone preview window** — browser-style back / forward / reload and an in-site address bar; switch between desktop and mobile simulation at any time (device presets for iPhone, Galaxy, Pixel and more, with taps delivered as real touch events) plus an Android edge-swipe back gesture.
- **Eleven built-in themes** — six for docs sites and five for blogs, spanning minimal, serif, terminal, magazine and a VitePress-style look; a visual settings panel puts colors, font sizes, shadows and motion under your control; blog themes cover tag colors, an archive page, footer links and a custom top-bar nav.
- **Theme maker** — duplicate any built-in theme, edit templates and styles with a live preview, then export as a ZIP to share.
- **Site plugins** — two built-ins: **site search** (a site-wide index generated at build time, type-to-search with highlighted snippets) and **image preview** (click an image to open a lightbox with zoom, rotation and pixel-perfect rendering; resolution auto-refreshes after zooming so enlarged images stay sharp); import custom JS/CSS plugins, or duplicate a built-in one to build on top of it.

### Publishing & maintenance

- **GitHub Pages publishing** — push with a personal access token in one click; site content is rebuilt automatically on publish (no manual build needed first), the repo, branch and Pages are created automatically, no Git needed; works with personal and organization accounts and custom domains, and a proxy can be configured to speed up uploads; on Windows the success notification carries "View publish status / View site" action buttons.
- **Background publishing & cancel** — switch to another site while publishing and the task keeps running in the background, with a status pill in the bottom-right corner: click it for progress and logs, quick actions to view the published site, jump back to the publish page, or cancel; cancelling stops the upload and reverts the site reference to the previous version, leaving the live site unchanged.
- **Update check** — check for the latest GitHub release from Settings, download with one click (pause and resume supported), and an update wizard installs the new version automatically.
- **Self-healing startup** — startup failures recover in steps (reload → clear cache → show diagnostics); white screens caused by corrupted UI-layer data mostly fix themselves.
- **Local-first** — all data lives inside the folder you choose; backup = copy; no backend, no telemetry.
- **Bilingual UI** — switch between Chinese and English from the title bar.

## Design

Plain (素) structure (构): a gray-white palette, a single ink accent, the system font stack, a 4px base grid, 8px radii, and one easing curve `cubic-bezier(0.23, 1, 0.32, 1)`. No gradients, no glows, no decoration for its own sake — hierarchy comes from type size, weight and whitespace. Form controls are custom-drawn: dropdowns open a floating panel with arrow-key selection and a check mark on the active option; sliders use a 4px track with an ink progress fill, and the thumb scales up with a soft ring on press; checkboxes fill with ink and the check mark pops in; the color picker is a custom floating layer — a swatch plus hex value as the trigger, with a saturation/brightness area and hue strip that track the pointer 1:1; keyboard focus rings land on the control itself.

## Getting started

### Regular users

Download an installer for your platform from [GitHub Releases](https://github.com/MogroWang/Plainstruct/releases):

- **Windows x64** — portable zip (`Plainstruct-<version>-Windows-x64-Portable.zip`; unzip and run `plainstruct.exe`); auto-update overwrites the app with the same package.
- **macOS (Apple Silicon)** — a dmg disk image (drag into Applications) or a zip archive (unzip and move into Applications), both bundling a repair script. The app is ad-hoc signed and not notarized; if macOS says it is "damaged", double-click **损坏修复.command (Repair Damaged)** inside the package and enter your password (only to remove the quarantine flag), or run `sudo xattr -r -d com.apple.quarantine /Applications/Plainstruct.app` in a terminal. Plainstruct is open source — this fix only clears Gatekeeper's quarantine flag on an un-notarized app and changes nothing inside it.

First run:

1. "New site" — pick **Documentation** or **Blog**, enter a name, and choose an empty folder.
2. Create documents in the tree and start writing (declare title, description and date with a `---` front-matter block).
3. One-click build on the Build page to preview the final site.
4. Pick or customize a theme on the Theme page (the list is filtered by site type).
5. On the Publish page pick the **account type** (Personal / Organization), fill in your username (or organization), repo and token, and publish.

### Access token

Create one at [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens) with the `repo` scope. The token is stored only in your site folder at `.plainstruct/github.json` and never uploaded anywhere; use it on private devices.

To **publish into an organization**, switch the account type to "Organization" on the Publish page and authorize the token for that org: classic tokens need the org checked when created; fine-grained tokens must select the org and grant repository read/write (Administration / Contents), and the org must allow members to create repositories. If the organization has Pages disabled, the content is still pushed — enable Pages in the org settings or turn it on manually.

## Site folder layout

```
<your site folder>/
├── content/            # documents & assets (openable with any editor)
│   ├── index.md        # site home
│   ├── asset/          # site image assets (inserted images are copied here)
│   └── guide/
│       ├── index.md    # folder landing page (nav folder titles come from its title)
│       └── setup.md
├── .plainstruct/       # Plainstruct metadata
│   ├── site.json       # site config (name / description / both logos / theme / language)
│   ├── github.json     # publish config (contains the token — keep private)
│   ├── order.json      # manual document order (generated by dragging the tree)
│   ├── themes/         # custom themes
│   └── plugins/        # site plugins (imported .js / .css, copied into the build)
└── build/              # build output (safe to delete & rebuild)
```

**Path mapping**: `index.md → index.html`, `foo.md → foo.html`, `foo/index.md → foo/index.html`. Link between documents with plain relative `.md` paths — they are rewritten to `.html` at build time. Folders without an `index.md` get an auto-generated directory listing page listing all documents and subfolders.

**Front-matter** fields (all optional):

- `title` — heading; `description` — description (blog card subtitle); `date` — date (the post stream sorts by date descending, undated posts come last); `cover` — cover image (relative path or external URL).
- `author` — byline; `aigc` — AIGC declaration (`none` = no AIGC content, `present` = contains AIGC, hidden by default).
- `tags` — article tags (comma- or enumeration-separated).
- `hidden` — hide the document (excluded from the post stream, navigation and search index; reachable only via direct link).

Document ordering does not rely on front-matter: drag a document onto a row's top/bottom edge in the tree to arrange it manually — the order is saved in `.plainstruct/order.json`.

On a **blog site** the home page is the post stream: posts render as cards (cover, title, date and subtitle), the per-page count is adjustable in the theme settings and overflow automatically generates paginated pages; article pages get a right-hand table of contents (extracted from the headings, highlighting the current section on scroll); if a root `index.md` exists its body renders above the stream and can serve as an announcement area; the home page can also **group the card stream by category** (top-level folders). Every folder without an `index.md` gets an auto-generated landing page, and the site ships an **archive page** (all non-hidden posts, switchable between list / category / card-stream views).

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
    { "key": "accentColor", "label": "Accent", "type": "color", "default": "#333333", "category": "Colors & Fonts" },
    { "key": "sidebarWidth", "label": "Sidebar width", "type": "number", "default": 260, "min": 200, "max": 360, "step": 10 },
    { "key": "bodyFont", "label": "Body font", "type": "select", "default": "system", "options": ["system", "serif"] },
    { "key": "showDescription", "label": "Show description", "type": "boolean", "default": true }
  ]
}
```

Field types: `color` / `text` / `number` / `select` / `boolean`. The `config` array drives the visual settings panel automatically; each field can carry `"category": "Section name"` to group the panel into sections with quick-jump buttons on top. `type` declares which site type the theme serves (`docs` / `blog`, default `docs`); the theme list is filtered by the current site's type.

### Template context

Available in `layout.hbs` and `page.hbs`:

```handlebars
{{site.name}} {{site.description}} {{site.logo}} {{site.favicon}}      {{!-- site info; logo/favicon are page-relative URLs (favicon falls back to logo when unset) --}}
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

Built-in helpers: `asset`, `eq`. Files under `partials/*.hbs` are registered by filename (`partials/nav.hbs` → `{{> nav}}`); recursive partials are supported.

On the Theme page you can duplicate a built-in theme, edit templates & styles with a live preview, and export a ZIP to share; others simply import the ZIP.

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

- **Frontend**: Vue 3 + TypeScript + Vite + Pinia + Tailwind CSS 4 (custom Plainstruct tokens); CodeMirror 6 editor; markdown-it + highlight.js rendering; Handlebars templates.
- **Desktop**: Tauri 2 (Rust). File IO, ZIP handling and the GitHub API live in Rust commands; a `site://` custom protocol serves the site folder directly, so the build preview matches the published output exactly.
- **No backend**: app state lives in a `data/` folder next to the executable (portable — data travels with the app; it falls back to the system app-data directory when that location is not writable), while site data lives entirely in the site folder.

## Project layout

```
├── public/                # app logos: logo.svg (mark) / logo-full.svg (wordmark, with -dark variant)
├── scripts/               # icon generation (incl. macOS full-bleed icon) / portable packaging
├── src/                   # frontend source
│   ├── ipc/               # Tauri IPC wrapper + browser mock
│   ├── lib/               # path mapping / Markdown / theme engine / build pipeline
│   ├── themes/            # built-in themes (plain-light / plain-dark / ink / terminal / gallery / vitepress / blog-light / blog-dark)
│   ├── stores/  components/  views/  i18n/
└── src-tauri/             # Rust desktop layer (commands / protocol / GitHub sync)
```

## Credits

Plainstruct 素构 by MogroWang Studio. The theme template interface and ZIP format are free for third-party extensions.
