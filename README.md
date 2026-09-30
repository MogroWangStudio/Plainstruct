<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo-full-dark.svg">
    <img src="public/logo-full.svg" alt="素构 Plainstruct" width="420">
  </picture>
</p>

<h1 align="center">素构 Plainstruct</h1>

<p align="center">本地运行的静态网站创建器,文档站与博客皆宜。</p>
<p align="center">在本地写 Markdown，一键构建、本地预览、发布到 GitHub Pages。</p>


[English](./README.en.md) · [更新日志](./changelog.md)

## 特性

- **两类站点** —— 新建时可选**文档站点**(侧栏目录导航,适合知识库与产品手册)或**博客站点**(首页为按日期排序的文章流,文章页带目录指引);站点类型可随时在站点设置中切换,主题列表自动按类型过滤,互不混用
- **内容管理** —— 文件夹与 Markdown 文档的树形管理,新建(可自定义标题)/重命名/删除(进回收站)/导入;拖拽移动带插入位置指示(行边缘 = 移动到该行所在目录,文件夹中部 = 移入该文件夹),拖到目标行上/下边缘即可**手动排序**(同目录重排、跨目录插入到目标位置,多选成组移动),顺序保存在 `.plainstruct/order.json`,构建站点的导航、目录页与上/下篇均按此顺序输出;支持多选:Shift 范围选择、Ctrl/⌘ 点选、批量拖拽移动,拖过折叠的文件夹稍候自动展开;「主页」固定置顶在文件树顶部;底部新增独立分割的**资产栏**(集中列出站点 `asset/` 中的图片,旧站点的 `images/` 同样识别,不进入站点输出),支持卡片与列表两种视图,按住任意图片拖入正文即可插入 Markdown 图片引用;文件按类型显示图标(Markdown 文档 / 图片);右键文档可直接打开「编辑配置头」表单;文件树、编辑器与输入框均有专属右键菜单(新建/导入/重命名/删除、剪切/复制/粘贴/全选)
- **编辑与实时预览** —— CodeMirror 6 编辑器与渲染预览左右对照,比例滚动同步,自动保存;格式工具栏一键插入标题/加粗/斜体/删除线/引用/列表/链接/图片/表格/代码块/首行缩进/硬换行,另有**文字左/中/右对齐**与**图片左/中/右对齐**按钮(以 HTML 对齐容器包裹,全部主题的正文样式显式支持,选区为图片时自动包裹、未选中时插入模板);**插入图片有引导**:选取本地图片后自动复制进站点 `content/asset/` 文件夹(新建站点时预建,重名自动加序号),光标处插入按当前文档位置换算的相对路径(子目录文档自动加 `../` 前缀),光标落在 front-matter 内时自动移到其后的正文区,构建与预览都能正确显示;完整快捷键:`⌘/Ctrl+1..6` 标题、`⌘B` 加粗、`⌘I` 斜体、`⌘E` 行内代码、`⌘K` 链接、`⌘⇧X` 删除线、`⌘⇧C` 代码块、`⌘⇧7/8/9` 有序/无序/引用、`⌘⇧T` 任务列表,`Enter` 默认为硬换行(行尾两空格,空行同样生效,列表行自动续行)、`Tab` 默认为**添加**首行缩进(`Shift+Tab` 移除,缩进符数量可配置,中文常用 2 个全角空格),硬换行(¶)与首行缩进(⇥)支持**可见标记显示**,键位与标记均可在设置中调整;「编辑配置头」以表单弹窗可视化调整 front-matter(标题/描述输入框、日期选择器、封面图从站点资产(asset)建议中选择或一键导入本地图片,确认后写回,留空字段不写入,自定义字段保留);**新建文档弹窗内嵌配置头设置**(标题/描述/日期/封面一次填好);预览与构建共用同一渲染管线,所见即所得
- **资产管理** —— 文件树底部的资产栏与「资产」页集中管理站点 `asset/` 文件夹(兼容旧 `images/`)中的图片:左侧卡片网格、右侧宽度可调的详情窗(大图预览与引用文档列表,点击直达对应文档);重命名时自动同步更新引用文档中的路径(有未保存修改的文档除外),删除提供引用失效提示与移入回收站的二级确认
- **站点管理** —— 站点名称、描述、Logo、站点语言(写入 `<html lang>`,可选预设或自定义语言代号)与浏览器标题格式(`{page} · {site}` 占位符)均可配置;站点 Logo 同步作为全站收藏夹图标(favicon)
- **一键构建** —— 产物为纯静态 HTML;所有站内链接与资源使用**相对路径**,部署到 GitHub Pages 仓库子路径、自定义域名或本地直接打开都不会乱;站点图片统一存放在 `content/asset/` 文件夹(插入图片时自动复制进去,旧站点沿用 `images/`),构建后原样输出为站点根下的 `asset/`,Markdown 中的引用按所在页面位置自动换算;没有 index.md 的文件夹自动生成目录列表页;构建时全量链接校验,失效链接在报告中列出;报告含页面数、资源数、耗时与**站点总占用大小**;独立预览窗口记忆位置与尺寸,构建刷新原地重载;文档保存与主题/主题配置变更后自动防抖重建,构建预览与产物始终保持最新
- **主题系统** —— 内置十款主题:文档站点用「素构 · 浅色」「素构 · 暗色」(侧栏布局)、「墨阅」(报刊衬线风)、「终端」(命令行风)、「画廊」(卡片现代风),博客站点用「手记 · 浅色」「手记 · 深色」(卡片式文章流)、「专栏」(杂志衬线报头)、「日志」(极客等宽深色)、「留白」(极简黑白居中),全部支持卡片/列表式文章流、每页篇数配置与页码切换、文章页 TOC;博客主题的**右上角导航可自定义**(选择显示哪些文章/文件夹,并可设最多显示数量,顶栏不再被挤满),未设置封面图的文章默认显示文档图标占位封面,另提供**文章卡片并排列数、封面图高度与顶栏宽度**(与正文宽度解绑)三项布局配置,以及品牌与动效配置 —— Logo/站点标题单独开关、Logo 宽/高百分比与圆角可调、Logo/标题/导航各自的**悬停反馈**(淡化/放大/强调色/下划线/底色等)、文章卡片一般与悬停两态**阴影**(预设无/轻/中/深,或**自定义** X/Y 偏移、模糊、扩散与不透明度)与**卡片悬停反馈**(无/上浮/下沉/放大/缩小/淡化/倾斜)及其**过渡曲线与时长**(标准/缓出/缓入/线性/弹性,或自定义 cubic-bezier 与 80–800ms)、跳转页面时的**页面加载动画**(转圈/点点/进度条,可关闭);全部主题支持**正文字体切换**(系统/衬线/等宽/自定义 font-family);文档可显示 front-matter 日期(主题内可开关);目录支持折叠(跨页记忆展开状态,当前页所在目录自动展开),页面过渡动画预设,可选「由 Plainstruct 创建」底部署名;可视化配置面板(颜色/字号/选项/开关,数值支持**双击直接输入**与偏离默认值时的**一键重置**);主题制作器(代码编辑 + 实时预览,右侧预览可点击站内链接直接浏览各页面);主题以 ZIP 包导入导出
- **个性化外观** —— 应用本身提供浅色、暗色、素笺、青瓷、深海、紫檀六套配色与跟随系统,设置页以配色预览卡片挑选,即改即生效;界面与编辑器字体可选系统默认/衬线/等宽/自定义,另提供**界面字号滑块**(85%–130%,只缩放文字、布局自适应)与**界面字重滑块**(400–600)设置
- **GitHub Pages 发布** —— 使用个人访问令牌,通过 GitHub API 把构建结果作为**单次原子提交**推送到仓库,自动创建仓库/分支/开启 Pages,无需安装 Git;发布失败时提示 GitHub 返回的具体原因;发布成功的一刻有短暂的纸屑庆祝动效(程度可在设置中调整:轻/标准/夸张,或关闭),随后自动监听 Pages 构建 —— 完成后亮起「查看站点」并弹出提示,发布按钮居中加宽、发布中为非线性加载动效、完成后变为「重新发布」
- **应用更新检查** —— 设置页一键检查更新,对比 GitHub 最新 Release,提示新版本、发布说明与发布时间;检测到新版本可一键下载(支持暂停与断点续传),完成后「重启并更新」拉起更新向导 —— 由向导关闭应用、覆盖安装并自动启动新版本
- **启动自愈** —— 启动失败自动分级恢复:先自动重载,仍失败则清理浏览器缓存后重载,依旧失败才显示诊断信息交人工反馈,界面层数据损坏导致的白屏多数无需手动处理;设置 → 数据另提供「清除浏览器缓存」一键急救
- **本地优先** —— 所有数据保存在你选择的站点文件夹内,备份即复制;无后端、无遥测
- **中英双语界面** —— 标题栏一键切换

## 界面与设计

素即素净,构即结构:灰白主色、单一墨色强调、系统字体栈、4px 基准网格、8px 圆角、统一缓动 `cubic-bezier(0.23, 1, 0.32, 1)`。无渐变、无发光、无多余装饰,层级全部来自字号、字重与留白。表单控件统一自绘 —— 下拉选择以浮出面板呈现,方向键即可选择、选中项带对勾标记;滑动条以 4px 轨道与墨色进度填充呈现,拇指按压即放大并泛出光圈;勾选框勾选时以墨色实底填充、对勾弹性弹出;键盘焦点圈都落在控件本身。

## 安装与使用

### 普通用户

从 [GitHub Releases](https://github.com/MogroWang/Plainstruct/releases) 下载对应平台的安装包:

- **Windows x64**:免安装版 zip(`Plainstruct-版本号-Windows-x64-Portable.zip`,解压后双击 `plainstruct.exe`),自动更新也以此包覆盖升级
- **macOS(Apple Silicon)**:dmg 磁盘镜像(拖入「应用程序」)或 zip 压缩包(解压后移入「应用程序」),两者均附「损坏修复.command」。应用为 ad-hoc 签名、未经 Apple 公证,首次打开若提示「已损坏」,双击包内的**「损坏修复.command」**并输入开机密码(仅用于移除隔离标记)即可;也可在终端手动执行 `sudo xattr -r -d com.apple.quarantine /Applications/Plainstruct.app`。本软件开源,该修复仅移除 Gatekeeper 对未公证应用的「隔离」标记,不改动应用内容

首次使用:

1. 「新建站点」—— 选择**文档站点**或**博客站点**,填写站点名称,选择一个空文件夹
2. 在左侧文件树新建文档,开始写作(用 `---` 包裹的 front-matter 声明标题/描述/日期;把文档拖到目标行的上/下边缘即可排序)
3. 「构建」页一键构建,即可实时预览最终站点
4. 「主题」页挑选或定制主题(列表会按站点类型过滤)
5. 「发布」页填入 GitHub 用户名/仓库名/访问令牌,一键发布

### 访问令牌(Token)

在 [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens) 创建,勾选 `repo` 权限即可。令牌仅保存在站点文件夹的 `.plainstruct/github.json` 中,不会上传到任何地方;请在私人设备上使用。

## 站点文件夹结构

```
<你的站点文件夹>/
├── content/            # 文档与资源(可随时用其他编辑器打开)
│   ├── index.md        # 站点首页
│   └── asset/          # 站点图片资产(插入图片自动复制到这里)
│   └── guide/
│       ├── index.md    # 目录落地页(导航里文件夹标题取自它的 title)
│       └── setup.md
├── .plainstruct/       # 素构配置
│   ├── site.json       # 站点配置(名称/描述/Logo/主题/语言)
│   ├── github.json     # 发布配置(含令牌,注意保密)
│   ├── order.json      # 文档手动排序(拖拽内容树自动生成)
│   └── themes/         # 自定义主题
└── build/              # 构建输出(可整删重建)
```

**路径映射规则**:`index.md → index.html`、`foo.md → foo.html`、`foo/index.md → foo/index.html`;文档间链接直接写 `.md` 相对路径,构建时自动改写为 `.html`。没有 `index.md` 的文件夹会在构建时自动生成目录列表页(`<目录>/index.html`),列出该文件夹下的全部文档与子目录;导航与目录页中的文件夹标题均可点击跳转。

**Front-matter** 支持 `title`(标题)、`description`(描述)、`date`(日期)与 `cover`(封面图,写图片路径或外链,博客站点的文章流会展示,如 `2026-09-26`,原样展示,可在主题配置中开关显示;博客站点首页的文章流按日期倒序排列,无日期的文章排在有日期之后)。文档排序不依赖 front-matter:在内容树中把文档拖到目标行的上/下边缘即可手动排列,顺序保存在 `.plainstruct/order.json`(旧版 front-matter 的 `order` 字段已不再参与排序)。

**博客站点**的首页即文章流:文章以**卡片**呈现(标题、日期与副标题),新建文档时可填写副标题(写入 front-matter 的 `description`),每篇文章可在配置头用 `cover:` 指定封面图(相对文档路径或外链),文章流卡片会展示封面;每页文章数可在主题配置中调整(3–30 篇),超出时自动生成 `page/N/` 分页页并提供页码与上/下页切换;文章页右侧提供页内目录(TOC,自动提取 h2/h3,滚动时高亮当前章节);首页若存在根目录 `index.md`,其正文会显示在文章流上方,可作为博客公告栏使用。顶栏右上角的导航默认显示全部顶层文章与文件夹,可在主题配置中改为**自定义选择**(勾选要显示的项,顺序随内容树),并受「最多显示」数量(1–12 项,默认 6)约束,任何模式下超出一律截断,顶栏不会被挤满。编辑器实时预览中,点击按钮或预览无法呈现的链接(如分页页)会提示仅供预览,查看完整站点请前往「构建」页。

## 主题开发

主题是一个 ZIP 包,结构如下:

```
theme.zip
├── theme.json          # 元数据与配置面板 schema(必填)
├── templates/
│   ├── layout.hbs      # 整页布局(必填)
│   └── page.hbs        # 正文区模板(可选,默认直接输出 content)
├── partials/           # Handlebars 局部模板,按文件名注册(可选)
└── assets/             # 样式/脚本等资源,经 {{asset}} 引用
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
    { "key": "accentColor", "label": "强调色", "type": "color", "default": "#333333" },
    { "key": "sidebarWidth", "label": "侧栏宽度", "type": "number", "default": 260, "min": 200, "max": 360, "step": 10 },
    { "key": "bodyFont", "label": "正文字体", "type": "select", "default": "system", "options": ["system", "serif"] },
    { "key": "showDescription", "label": "显示站点描述", "type": "boolean", "default": true }
  ]
}
```

字段类型:`color` / `text` / `number` / `select` / `boolean`。`config` 数组会自动生成可视化配置面板。`type` 声明主题适用的站点类型(`docs` / `blog`,缺省 `docs`),主题列表会按当前站点的类型过滤。

### 模板上下文(模板接口)

`layout.hbs` 与 `page.hbs` 内可用以下数据:

```handlebars
{{site.name}} {{site.description}} {{site.logo}}      {{!-- 站点信息,logo 为当前页相对地址 --}}
{{page.title}} {{page.description}} {{page.date}}     {{!-- 当前文档,date 为 front-matter 日期 --}}
{{{page.content}}}                                      {{!-- 三花括号:渲染后的 HTML --}}
{{page.url}} {{page.relPrefix}} {{page.isHome}}       {{!-- 输出路径 / 相对根前缀 / 是否站点首页 --}}
{{#each page.toc}} {{this.level}} {{this.text}} {{this.id}} {{/each}}   {{!-- 页内目录(博客站点) --}}
{{#each nav}} {{this.title}} {{this.url}} {{this.current}} {{this.children}} {{/each}}
{{#each posts}} {{this.title}} {{this.url}} {{this.date}} {{this.description}} {{/each}}  {{!-- 博客文章流 --}}
{{prev.title}} {{prev.url}} {{next.title}} {{next.url}}
{{config.accentColor}}                                  {{!-- 主题配置值 --}}
{{asset "style.css"}}                                   {{!-- 资源地址,自动按页面深度转相对路径 --}}
```

内置 helper:`asset`、`eq`;`partials/` 下的 `.hbs` 按文件名注册为局部模板(如 `partials/nav.hbs` → `{{> nav}}`),支持递归调用。

在「主题」页可以:复制内置主题为新主题 → 在制作器里编辑模板/样式并实时预览 → 导出 ZIP 分享;他人导入 ZIP 即可使用。

## 开发

环境要求:Node 20+、Rust;Windows 需 [VS Build Tools](https://visualstudio.microsoft.com/downloads/)(C++ 工作负载),macOS 需 Xcode Command Line Tools(`xcode-select --install`)。

```bash
npm install          # 安装前端依赖
npm run dev          # 纯浏览器开发(内置 mock 演示站点,无需 Rust)
npm run tauri dev    # 完整桌面应用开发
npm run check        # vue-tsc 类型检查
npm run build        # 前端类型检查 + 生产构建
cargo check          # 在 src-tauri/ 下,Rust 编译检查

npm run icons                          # 由 icon.png 生成全套应用图标
npm run windows:portable               # Windows x64 免安装构建 -> release/Plainstruct_版本号_Windows_x64_Portable.zip
npm run tauri -- build                 # 平台产物(dmg / app)
```

### 技术架构

- **前端**:Vue 3 + TypeScript + Vite + Pinia + Tailwind CSS 4(自定义素构令牌);编辑器 CodeMirror 6;渲染 markdown-it + highlight.js;模板 Handlebars
- **桌面**:Tauri 2(Rust)。文件 IO、ZIP、GitHub API 在 Rust 命令层;`site://` 自定义协议直读站点文件夹,构建预览与发布产物完全一致
- **无后端**:应用状态存于程序根目录的 `data/` 文件夹(便携式,数据随程序走;该目录不可写时自动回退系统应用数据目录),站点数据全部在站点文件夹内

## 目录结构

```
├── public/                # 应用 Logo:logo.svg(单标)/ logo-full.svg(全字标,含 -dark 暗色变体)
├── scripts/               # 图标生成(含 macOS 满铺图标适配)/ 免安装打包脚本
├── src/                   # 前端源码
│   ├── ipc/               # Tauri IPC 封装 + 浏览器 mock
│   ├── lib/               # 路径映射 / Markdown / 主题引擎 / 构建管线
│   ├── themes/            # 内置主题(plain-light / plain-dark / ink / terminal / gallery / blog-light / blog-dark)
│   ├── stores/  components/  views/  i18n/
└── src-tauri/             # Rust 桌面层(命令 / 协议 / GitHub 同步)
```

## 许可与署名

Plainstruct 素构 by MogroWang Studio。主题模板接口与 ZIP 格式可供第三方自由扩展。
