<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo-full-dark.svg">
    <img src="public/logo-full.svg" alt="素构 Plainstruct" width="420">
  </picture>
</p>

<h1 align="center">素构 Plainstruct</h1>

<p align="center">本地运行的静态网站创建器，文档站与博客皆宜。</p>
<p align="center">在本地写 Markdown，一键构建、本地预览、发布到 GitHub Pages。</p>

[English](./README.en.md) · [更新日志](./changelog.md)

## 特性

### 写作与内容

- **两类站点** —— 新建站点时可选「文档站点」（侧栏目录导航，适合知识库与产品手册）或「博客站点」（首页为按日期排序的文章流），之后也能在站点设置中随时切换。
- **文件树管理** —— 文件夹与 Markdown 文档统一管理：新建、重命名、删除（进系统回收站）、导入；拖到目标行的上／下边缘即可手动排序，顺序全站生效（导航、目录页与上下篇都按它输出），支持多选与批量移动。
- **拖入站内链接** —— 把文件树里的文档或目录拖进正文，即插入指向该页的站内链接（配置头标题优先作为链接文字），构建与预览会解析为站点页面地址，访客点击即跳转。
- **写作体验** —— 编辑器与实时预览左右对照、自动保存；格式工具栏与全套快捷键（标题、加粗、列表、表格、链接、代码块等）；`⌘/Ctrl+F` 查找与替换，支持正则表达式与区分大小写。
- **可视化配置头** —— 用表单设置标题、描述、日期、封面、作者署名、AIGC 声明与文章标签，不必手写 front-matter；新建文档时可一次填好。
- **文章标签** —— 在配置头填 `tags`，标签以药丸样式显示在文章卡片上，可在主题配置中逐个配色；博客文件夹页自动生成标签筛选条，点一下即可筛选。
- **资产管理** —— 文件树底部的资产栏与「资产」页集中管理站点图片：从访达／资源管理器拖入即导入，重命名自动更新引用路径，支持框选、批量移动与删除。

### 构建与外观

- **一键构建** —— 产物为纯静态 HTML，所有链接与资源都是相对路径，部署到 GitHub Pages 子路径、自定义域名或本地直接打开都不会乱；构建时全量校验链接，失效链接列在报告中。
- **独立预览窗口** —— 浏览器式后退／前进／刷新与站点地址栏；可在桌面端与移动端模拟之间随时切换（内置 iPhone、Galaxy、Pixel 等机型预设，点击以真实触摸事件送达页面），支持安卓左缘侧滑返回。
- **十一款内置主题** —— 文档站六款、博客五款，覆盖极简、衬线、终端、杂志与 VitePress 风格；可视化配置面板，颜色、字号、阴影、动效均可调；博客主题支持标签配色、归档页、友情链接与自定义顶栏导航。
- **主题制作器** —— 复制内置主题为新主题，编辑模板与样式并实时预览，主题以 ZIP 包导入导出，方便分享。
- **站点插件** —— 内置**站内搜索**（构建时生成全站索引，输入即搜、结果高亮）与**图片预览**（点击图片进入灯箱，支持缩放、旋转与像素级渲染，放大后自动刷新分辨率，不再发虚）；支持导入自定义 JS／CSS 插件，也可复制内置插件做二次开发。

### 发布与维护

- **局域网同步（电脑 ⇄ 手机）** —— 同一 Wi-Fi 下的设备自动互相发现，站点可以整包互传：电脑把站点推到手机继续编辑，手机改完再传回电脑；推送需对方确认，覆盖同名站点前自动备份（保留最近 5 份），GitHub 令牌等敏感配置不随传输离开设备；开启「信任此局域网」后推送自动接受、对方也可直接拉取。
- **移动端（安卓）** —— 功能与桌面端一致的 Android 应用（arm64 APK）：底部导航与抽屉式文件树的专属布局、全屏编辑／预览切换、长按文件树唤出操作菜单、模态改为底部面板；手机上的站点保存在应用数据目录内，新建、编辑、构建、发布与局域网同步全部可用。
- **GitHub Pages 发布** —— 使用访问令牌一键推送，发布时自动重新构建站点内容（无需先手动构建），自动创建仓库、分支并开启 Pages，无需安装 Git；支持个人与组织账户、自定义域名，并可配置代理加速上传；发布成功后系统通知带「查看发布情况／查看站点」动作按钮。
- **后台发布与取消** —— 发布期间切换到其他站点，发布会在后台继续进行，右下角显示发布状态药丸栏：点开即见进度与运行日志，可快速查看已发布网页、跳回发布页或取消发布；取消会中止上传并把站点引用回退到原版本，线上内容保持不变。
- **应用更新检查** —— 设置页一键检查 GitHub 最新版本，新版本可一键下载（支持暂停与断点续传），更新向导自动完成覆盖安装。
- **启动自愈** —— 启动失败时自动分级恢复（重载 → 清理缓存 → 显示诊断信息），界面层数据损坏导致的白屏多数无需手动处理。
- **本地优先** —— 所有数据保存在你选择的站点文件夹内，备份即复制；无后端、无遥测。
- **中英双语界面** —— 标题栏一键切换。

## 界面与设计

素即素净，构即结构：灰白主色、单一墨色强调、系统字体栈、4px 基准网格、8px 圆角、统一缓动 `cubic-bezier(0.23, 1, 0.32, 1)`。无渐变、无发光、无多余装饰，层级全部来自字号、字重与留白。表单控件统一自绘 —— 下拉选择以浮出面板呈现，方向键即可选择、选中项带对勾标记；滑动条以 4px 轨道与墨色进度填充呈现，拇指按压即放大并泛出光圈；勾选框勾选时以墨色实底填充、对勾弹性弹出；取色器为自绘浮层，触发器是色块加十六进制值，面板内饱和度／明度区与色相条按下即取色、拖动 1:1 跟随指针；键盘焦点圈都落在控件本身。

## 安装与使用

### 普通用户

从 [GitHub Releases](https://github.com/MogroWang/Plainstruct/releases) 下载对应平台的安装包：

- **Windows x64**：免安装版 zip（`Plainstruct-版本号-Windows-x64-Portable.zip`，解压后双击 `plainstruct.exe`），自动更新也以此包覆盖升级。
- **macOS（Apple Silicon）**：dmg 磁盘镜像（拖入「应用程序」）或 zip 压缩包（解压后移入「应用程序」），两者均附「损坏修复.command」。应用为 ad-hoc 签名、未经 Apple 公证，首次打开若提示「已损坏」，双击包内的**「损坏修复.command」**并输入开机密码（仅用于移除隔离标记）即可；也可在终端手动执行 `sudo xattr -r -d com.apple.quarantine /Applications/Plainstruct.app`。本软件开源，该修复仅移除 Gatekeeper 对未公证应用的「隔离」标记，不改动应用内容。
- **Android（arm64-v8a）**：APK 安装包（`Plainstruct-版本号-android.apk`）。安装时允许「安装未知来源应用」即可；升级直接覆盖安装（同一签名）。手机端站点保存在应用私有数据目录，卸载应用会连同站点一起删除，重要内容请先经「同步」传回电脑。

首次使用：

1. 「新建站点」—— 选择**文档站点**或**博客站点**，填写站点名称，选择一个空文件夹。
2. 在左侧文件树新建文档，开始写作（用 `---` 包裹的 front-matter 声明标题、描述、日期）。
3. 「构建」页一键构建，即可实时预览最终站点。
4. 「主题」页挑选或定制主题（列表会按站点类型过滤）。
5. 「发布」页选择**账户类型**（个人用户／组织），填入用户名（或组织名）、仓库名与访问令牌，一键发布。

### 访问令牌（Token）

在 [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens) 创建，勾选 `repo` 权限即可。令牌仅保存在站点文件夹的 `.plainstruct/github.json` 中，不会上传到任何地方；请在私人设备上使用。

**发布到组织**时请在发布页把账户类型切到「组织」，并让令牌获得该组织的授权：经典令牌创建时勾选组织；细粒度令牌需选择该组织并授予仓库读写权限（Administration／Contents），且组织需允许成员创建仓库。若组织禁用了 GitHub Pages，内容仍会正常推送，但需在组织设置中放开 Pages 或手动开启。

## 站点文件夹结构

```
<你的站点文件夹>/
├── content/            # 文档与资源（可随时用其他编辑器打开）
│   ├── index.md        # 站点首页
│   ├── asset/          # 站点图片资产（插入图片自动复制到这里）
│   └── guide/
│       ├── index.md    # 目录落地页（导航里文件夹标题取自它的 title）
│       └── setup.md
├── .plainstruct/       # 素构配置
│   ├── site.json       # 站点配置（名称／描述／双 Logo／主题／语言）
│   ├── github.json     # 发布配置（含令牌，注意保密）
│   ├── order.json      # 文档手动排序（拖拽内容树自动生成）
│   ├── themes/         # 自定义主题
│   └── plugins/        # 站点插件（导入的 .js／.css，构建时拷入产物）
└── build/              # 构建输出（可整删重建）
```

**路径映射规则**：`index.md → index.html`、`foo.md → foo.html`、`foo/index.md → foo/index.html`；文档间链接直接写 `.md` 相对路径，构建时自动改写为 `.html`。没有 `index.md` 的文件夹会在构建时自动生成目录列表页，列出该文件夹下的全部文档与子目录。

**Front-matter** 支持以下字段（均可留空）：

- `title` 标题；`description` 描述（博客文章卡片副标题）；`date` 日期（文章流按日期倒序，无日期的文章排在最后）；`cover` 封面图（相对路径或外链）。
- `author` 作者署名；`aigc` AIGC 声明（`none` = 无任何 AIGC、`present` = 存在 AIGC，缺省不显示）。
- `tags` 文章标签（逗号或顿号分隔）。
- `hidden` 隐藏文档（不进文章流、导航与搜索索引，仅可通过链接访问）。

文档排序不依赖 front-matter：在文件树中把文档拖到目标行的上／下边缘即可手动排列，顺序保存在 `.plainstruct/order.json`。

**博客站点**的首页即文章流：文章以卡片呈现（封面图、标题、日期与副标题），每页文章数可在主题配置中调整，超出时自动生成分页页；文章页右侧提供页内目录（TOC，自动提取各级标题，滚动时高亮当前章节）；首页若存在根目录 `index.md`，其正文会显示在文章流上方，可作为公告栏使用；首页还可开启「卡片流按分类分组」，按顶层文件夹归组展示。每个没有 `index.md` 的文件夹自动生成落地页，站点也会自动生成**归档页**（全部非隐藏文章，支持列表／分类／卡片流三种视图）。

## 主题开发

主题是一个 ZIP 包，结构如下：

```
theme.zip
├── theme.json          # 元数据与配置面板 schema（必填）
├── templates/
│   ├── layout.hbs      # 整页布局（必填）
│   └── page.hbs        # 正文区模板（可选，默认直接输出 content）
├── partials/           # Handlebars 局部模板，按文件名注册（可选）
└── assets/             # 样式／脚本等资源，经 {{asset}} 引用
```

### theme.json

```json
{
  "id": "my-theme",
  "name": "我的主题",
  "version": "1.0.0",
  "author": "you",
  "description": "主题说明",
  "type": "docs",
  "config": [
    { "key": "accentColor", "label": "强调色", "type": "color", "default": "#333333", "category": "颜色与字体" },
    { "key": "sidebarWidth", "label": "侧栏宽度", "type": "number", "default": 260, "min": 200, "max": 360, "step": 10 },
    { "key": "bodyFont", "label": "正文字体", "type": "select", "default": "system", "options": ["system", "serif"] },
    { "key": "showDescription", "label": "显示站点描述", "type": "boolean", "default": true }
  ]
}
```

字段类型：`color` / `text` / `number` / `select` / `boolean`。`config` 数组会自动生成可视化配置面板；每个字段可加 `"category": "分组名"`，面板会按分类分组并在顶部提供快速跳转按钮。`type` 声明主题适用的站点类型（`docs` / `blog`，缺省 `docs`），主题列表会按当前站点的类型过滤。

### 模板上下文（模板接口）

`layout.hbs` 与 `page.hbs` 内可用以下数据：

```handlebars
{{site.name}} {{site.description}} {{site.logo}} {{site.favicon}}      {{!-- 站点信息，logo/favicon 为当前页相对地址（站点外图标未设置时回退为 logo） --}}
{{page.title}} {{page.description}} {{page.date}}     {{!-- 当前文档，date 为 front-matter 日期 --}}
{{{page.content}}}                                      {{!-- 三花括号：渲染后的 HTML --}}
{{page.url}} {{page.relPrefix}} {{page.isHome}}       {{!-- 输出路径 / 相对根前缀 / 是否站点首页 --}}
{{#each page.toc}} {{this.level}} {{this.text}} {{this.id}} {{/each}}   {{!-- 页内目录（博客站点） --}}
{{#each nav}} {{this.title}} {{this.url}} {{this.current}} {{this.children}} {{/each}}
{{#each posts}} {{this.title}} {{this.url}} {{this.date}} {{this.description}} {{/each}}  {{!-- 博客文章流 --}}
{{prev.title}} {{prev.url}} {{next.title}} {{next.url}}
{{config.accentColor}}                                  {{!-- 主题配置值 --}}
{{asset "style.css"}}                                   {{!-- 资源地址，自动按页面深度转相对路径 --}}
```

内置 helper：`asset`、`eq`；`partials/` 下的 `.hbs` 按文件名注册为局部模板（如 `partials/nav.hbs` → `{{> nav}}`），支持递归调用。

在「主题」页可以：复制内置主题为新主题 → 在制作器里编辑模板／样式并实时预览 → 导出 ZIP 分享；他人导入 ZIP 即可使用。

## 开发

环境要求：Node 20+、Rust；Windows 需 [VS Build Tools](https://visualstudio.microsoft.com/downloads/)（C++ 工作负载），macOS 需 Xcode Command Line Tools（`xcode-select --install`）。

```bash
npm install          # 安装前端依赖
npm run dev          # 纯浏览器开发（内置 mock 演示站点，无需 Rust）
npm run tauri dev    # 完整桌面应用开发
npm run check        # vue-tsc 类型检查
npm run build        # 前端类型检查 + 生产构建
cargo check          # 在 src-tauri/ 下，Rust 编译检查

npm run icons                          # 由 icon.png 生成全套应用图标
npm run windows:portable               # Windows x64 免安装构建 -> release/Plainstruct_版本号_Windows_x64_Portable.zip
npm run tauri -- build                 # 平台产物（dmg / app）
npm run android:build                  # Android arm64 APK（需 Android SDK/NDK 与 Rust android target）
```

安卓 APK 的发布签名：CI 从 secrets `ANDROID_RELEASE_KEYSTORE_B64` / `ANDROID_RELEASE_KEYSTORE_PASSWORD` 解出 keystore 写入 `src-tauri/gen/android/keystore.properties`（git 忽略）；本地构建时按同一格式自行放置即可，缺失时回退 debug 密钥（无法覆盖安装正式版）。

### 技术架构

- **前端**：Vue 3 + TypeScript + Vite + Pinia + Tailwind CSS 4（自定义素构令牌）；编辑器 CodeMirror 6；渲染 markdown-it + highlight.js；模板 Handlebars。
- **桌面**：Tauri 2（Rust）。文件 IO、ZIP、GitHub API 在 Rust 命令层；`site://` 自定义协议直读站点文件夹，构建预览与发布产物完全一致。
- **移动端（安卓）**：同一 Tauri 2 工程交叉编译到 Android（WebView 内核），Rust 命令层、站点模型与构建管线完全复用；移动端 UI 为独立骨架（`MobileShell` / `EditorMobile`），与桌面共享全部视图与 store。
- **局域网同步**：UDP 广播发现（端口 44223）+ 手写 HTTP/1.1 over TCP 传输，两端同一 Rust 实现；站点打包为 JSON 包（文本直传、二进制 base64），`build/` 产物与 `github.json` 不随同步。
- **无后端**：应用状态存于程序根目录的 `data/` 文件夹（便携式，数据随程序走；该目录不可写时自动回退系统应用数据目录），站点数据全部在站点文件夹内。

## 目录结构

```
├── public/                # 应用 Logo：logo.svg（单标）/ logo-full.svg（全字标，含 -dark 暗色变体）
├── scripts/               # 图标生成（含 macOS 满铺图标适配）/ 免安装打包脚本
├── src/                   # 前端源码
│   ├── ipc/               # Tauri IPC 封装 + 浏览器 mock
│   ├── lib/               # 路径映射 / Markdown / 主题引擎 / 构建管线
│   ├── themes/            # 内置主题（plain-light / plain-dark / ink / terminal / gallery / blog-light / blog-dark）
│   ├── stores/  components/  views/  i18n/
└── src-tauri/             # Rust 层（命令 / 协议 / GitHub 同步 / 局域网同步）
    └── gen/android/       # Android 工程（提交仓库;含签名配置,keystore 本身不入库）
```

## 许可与署名

Plainstruct 素构 by MogroWang Studio。主题模板接口与 ZIP 格式可供第三方自由扩展。
