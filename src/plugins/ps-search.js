/* 素构 · 站内搜索插件
 * 数据源:预览为页面内联的 #ps-search-data JSON;构建产物按 data-index-url 懒加载同源索引。
 * 交互:右下角入口 + ⌘/Ctrl+K;↑↓ 选择、Enter 打开、Esc 关闭;高亮片段来自正文匹配。 */
(function () {
  "use strict";
  // 防重入以「标记元素」为标志:预览的 document.write 重写会复用同一个
  // document 对象(window 与 document 都不变,任何挂在二者上的标志都会把
  // 重写后的新页面挡在门外),但 DOM 会被清空 —— 标记元素随重写消失,
  // 据此判定是否需要重新初始化。
  if (document.getElementById("ps-search-init")) return;
  var initMark = document.createElement("div");
  initMark.id = "ps-search-init";
  initMark.style.display = "none";
  (document.body || document.documentElement).appendChild(initMark);

  var lang = (document.documentElement.lang || "zh-CN").toLowerCase();
  var zh = lang.indexOf("zh") === 0;
  var T = {
    placeholder: zh ? "搜索本站…" : "Search this site…",
    emptyHint: zh ? "输入关键词,回车打开选中结果" : "Type to search, Enter to open",
    noResult: zh ? "没有找到相关内容" : "No results",
    unavailable: zh ? "搜索索引不可用" : "Search index unavailable",
    openAria: zh ? "搜索" : "Search",
  };

  /* ---------- 明暗跟随站点:按 body 背景亮度判定(透明背景不判定) ---------- */
  try {
    var bg = getComputedStyle(document.body).backgroundColor;
    var m = bg.match(/[\d.]+/g);
    if (m && (m.length < 4 || +m[3] > 0)) {
      var lum = 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2];
      if (lum < 128) document.documentElement.setAttribute("data-ps-dark", "");
    }
  } catch (e) { /* 判定失败按浅色 */ }

  var ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>';

  /* ---------- DOM ---------- */
  var overlay, panel, input, list, escBtn, open = false;
  var docs = null; // 搜索数据 {pages:[{title,url,desc,text}]}
  var indexUrl = "";
  var rootPrefix = "";
  var flat = []; // 当前渲染的结果
  var active = -1;

  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  function build() {
    var host = document.body;
    if (entryPosition === "top") {
      // 顶栏最右侧:优先并入主题顶栏,找不到再固定右上角
      var bar = document.querySelector(".blog-topbar, .ps-topbar, header");
      if (bar) {
        host = bar;
      }
    }
    var entry;
    if (entryStyle === "bar") {
      // 长条文本框式:毛玻璃胶囊,点击即展开搜索面板
      entry = el("button", "ps-search-entry ps-search-bar", host);
      entry.innerHTML = ICON.replace('width="20" height="20"', 'width="15" height="15"') + "<span>" + T.placeholder + "</span>";
    } else {
      entry = el("button", "ps-search-entry ps-search-fab", host);
      entry.innerHTML = ICON;
    }
    entry.id = "ps-search-fab";
    if (entryPosition === "top" && host !== document.body) {
      entry.classList.add("ps-in-topbar");
    } else {
      entry.classList.add(entryPosition === "bl" ? "ps-pos-bl" : entryPosition === "top" ? "ps-pos-top" : "ps-pos-br");
    }
    entry.setAttribute("aria-label", T.openAria);
    entry.addEventListener("click", show);
    requestAnimationFrame(function () { entry.classList.add("ps-ready"); });

    overlay = el("div", "", document.body);
    overlay.id = "ps-search-overlay";
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) hide();
    });
    panel = el("div", "", overlay);
    panel.id = "ps-search-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    var row = el("div", "ps-search-inputrow", panel);
    row.innerHTML = ICON.replace('width="20" height="20"', 'width="17" height="17"');
    input = el("input", "", row);
    input.id = "ps-search-input";
    input.type = "text";
    input.placeholder = T.placeholder;
    input.setAttribute("aria-label", T.openAria);
    input.addEventListener("input", function () { render(input.value.trim()); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        move(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        var items = list.querySelectorAll(".ps-search-item");
        if (flat[active] && items[active]) items[active].click();
      }
    });
    escBtn = el("button", "", row);
    escBtn.id = "ps-search-esc";
    escBtn.textContent = "esc";
    escBtn.addEventListener("click", hide);

    list = el("div", "", panel);
    list.id = "ps-search-results";
    list.setAttribute("role", "listbox");

    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        open ? hide() : show();
      } else if (e.key === "Escape" && open) {
        hide();
      }
    });
  }

  /* ---------- 数据加载 ---------- */
  function ensureData() {
    if (docs || docs === false) return;
    var inline = document.getElementById("ps-search-data");
    if (inline) {
      try { docs = JSON.parse(inline.textContent); } catch (e) { docs = { pages: [] }; }
      return;
    }
    docs = false; // false = 加载中,完成前不再重复请求
    fetch(indexUrl)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (data) { docs = data; if (open) render(input.value.trim()); })
      .catch(function () { docs = { pages: [], broken: true }; if (open) render(input.value.trim()); });
  }

  /* ---------- 搜索 ---------- */
  function search(kw) {
    if (!docs || !docs.pages || !kw) return [];
    var k = kw.toLowerCase();
    var hits = [];
    for (var i = 0; i < docs.pages.length; i++) {
      var p = docs.pages[i];
      var title = (p.title || "").toLowerCase();
      var desc = (p.desc || "").toLowerCase();
      var text = (p.text || "").toLowerCase();
      var score = 0;
      if (title.indexOf(k) === 0) score += 5;
      else if (title.indexOf(k) >= 0) score += 3;
      if (desc.indexOf(k) >= 0) score += 2;
      if (text.indexOf(k) >= 0) score += 1;
      if (score) hits.push({ page: p, score: score });
    }
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits.slice(0, 12);
  }

  /** 命中词片段:命中位置前后各取一段,渲染时按关键词拆分成文本与 mark */
  function snippet(text, kw) {
    var idx = text.toLowerCase().indexOf(kw.toLowerCase());
    if (idx < 0) return text.slice(0, 130);
    var start = Math.max(0, idx - 42);
    var end = Math.min(text.length, idx + kw.length + 90);
    return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
  }

  /** 安全渲染标题/片段:仅用文本节点与 <mark>,不做 HTML 拼接 */
  function highlight(container, text, kw) {
    if (!kw) {
      container.textContent = text;
      return;
    }
    var lower = text.toLowerCase();
    var k = kw.toLowerCase();
    var from = 0;
    for (;;) {
      var idx = lower.indexOf(k, from);
      if (idx < 0) break;
      if (idx > from) container.appendChild(document.createTextNode(text.slice(from, idx)));
      var mark = el("mark", "", container);
      mark.textContent = text.slice(idx, idx + kw.length);
      from = idx + kw.length;
    }
    if (from < text.length) container.appendChild(document.createTextNode(text.slice(from)));
  }

  function render(kw) {
    list.textContent = "";
    flat = [];
    active = -1;
    if (docs === false) {
      note(T.placeholder);
      return;
    }
    if (docs && docs.broken) {
      note(T.unavailable);
      return;
    }
    if (!docs || !kw) {
      note(T.emptyHint);
      return;
    }
    var hits = search(kw);
    if (!hits.length) {
      note(T.noResult);
      return;
    }
    for (var i = 0; i < hits.length; i++) {
      var page = hits[i].page;
      var a = el("a", "ps-search-item", list);
      a.setAttribute("role", "option");
      a.href = rootPrefix + (page.url || "");
      var title = el("div", "ps-search-title", a);
      highlight(title, page.title || page.url, kw);
      var body = page.desc || page.text || "";
      var snip = el("div", "ps-search-snippet", a);
      highlight(snip, snippet(body, kw), kw);
      // 不拦截默认导航:正常站点直接跳转;预览 iframe 的链接接管逻辑也能正常工作
      a.addEventListener("click", function () { hide(); });
      flat.push(page);
    }
    setActive(0);
  }

  function note(msg) {
    var p = el("div", "ps-search-note", list);
    p.textContent = msg;
  }

  function move(dir) {
    if (!flat.length) return;
    setActive((active + dir + flat.length) % flat.length);
  }

  function setActive(i) {
    active = i;
    var items = list.querySelectorAll(".ps-search-item");
    for (var j = 0; j < items.length; j++) {
      items[j].setAttribute("aria-selected", j === i ? "true" : "false");
    }
    if (items[i]) items[i].scrollIntoView({ block: "nearest" });
  }

  /* ---------- 开合 ---------- */
  function show() {
    if (open) return;
    open = true;
    ensureData();
    overlay.classList.add("ps-open");
    document.documentElement.style.overflow = "hidden";
    input.value = "";
    render("");
    requestAnimationFrame(function () { input.focus(); });
  }

  function hide() {
    if (!open) return;
    open = false;
    overlay.classList.remove("ps-open");
    document.documentElement.style.overflow = "";
    input.blur();
  }

  /* ---------- 启动:数据源/根前缀/入口形式与位置来自注入的 script 标签 ---------- */
  var entryStyle = "button";   // button | bar
  var entryPosition = "br";    // br | bl | top
  function start() {
    var me = document.currentScript;
    if (!me) {
      var scripts = document.querySelectorAll("script[data-index-url]");
      me = scripts[scripts.length - 1];
    }
    if (me) {
      indexUrl = me.getAttribute("data-index-url") || "";
      rootPrefix = me.getAttribute("data-root-prefix") || "";
      entryStyle = me.getAttribute("data-style") === "bar" ? "bar" : "button";
      var pos = me.getAttribute("data-position");
      entryPosition = pos === "bottom-left" ? "bl" : pos === "topbar" ? "top" : "br";
    }
    // 内联注入通道(mock 预览):壳层经 window.__psSearchCfg 传入
    if (window.__psSearchCfg) {
      if (window.__psSearchCfg.style === "bar") entryStyle = "bar";
      if (window.__psSearchCfg.position === "bottom-left") entryPosition = "bl";
      else if (window.__psSearchCfg.position === "topbar") entryPosition = "top";
    }
    // 供置顶按钮等同位元素协调避让
    window.__psSearchCorner = entryPosition === "top" ? null : entryPosition;
    build();
    try {
      window.dispatchEvent(new Event("ps-search-ready"));
    } catch (e) { /* 事件不可用时,同位元素靠 load 兜底 */ }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
