/* 素构站点行为脚本:目录滚动高亮、目录点按动画、顶栏滚动态、置顶按钮、加载指示。
 * 由渲染管线在组页时注入(构建产物与预览同源),不随主题模板走,
 * 自定义主题的旧模板快照同样获得最新行为与修复;旧模板若残留内联版脚本,
 * 本脚本以捕获阶段接管目录点按并拦截其冒泡监听,不会双重滚动。
 * 各功能按元素存在性自防御,无对应结构的页面(如文档主题)自动退出。 */
(function () {
  var doc = document;
  var body = doc.body;
  if (!body) return;

  /* ---------- 滚动动画:贝塞尔缓动逐帧驱动;滚轮/触摸/按键随时接管 ---------- */
  var tweenRaf = 0;
  function cancelTween() {
    if (tweenRaf) {
      cancelAnimationFrame(tweenRaf);
      tweenRaf = 0;
    }
  }
  window.addEventListener("wheel", cancelTween, { passive: true });
  window.addEventListener("touchstart", cancelTween, { passive: true });
  window.addEventListener("keydown", cancelTween);

  function bezierFn(x1, y1, x2, y2) {
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    function sx(t) { return ((ax * t + bx) * t + cx) * t; }
    function sy(t) { return ((ay * t + by) * t + cy) * t; }
    function dx(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    return function (p) {
      var t = p;
      for (var i = 0; i < 6; i++) {
        var x = sx(t) - p;
        if (Math.abs(x) < 1e-5) break;
        var d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= x / d;
      }
      return sy(Math.min(1, Math.max(0, t)));
    };
  }
  function easeOf() {
    var map = {
      "标准": [0.23, 1, 0.32, 1],
      "缓出": [0, 0, 0.58, 1],
      "缓入": [0.42, 0, 1, 1],
      "线性": [0, 0, 1, 1],
      "弹性": [0.3, 1.35, 0.45, 1],
    };
    var name = body.getAttribute("data-toc-click-ease") || "标准";
    var v = map[name];
    if (!v) {
      var c = (body.getAttribute("data-toc-click-ease-custom") || "").split(",").map(Number);
      v = c.length === 4 && c.every(function (n) { return isFinite(n); }) ? c : map["标准"];
    }
    return bezierFn(v[0], v[1], v[2], v[3]);
  }
  function clickDuration() {
    var dur = parseInt(body.getAttribute("data-toc-click-dur") || "450", 10);
    return isFinite(dur) && dur >= 60 ? dur : 450;
  }
  function tweenScroll(to, dur, ease) {
    cancelTween();
    var from = window.pageYOffset || 0;
    var t0 = performance.now();
    function step(now) {
      var p = dur > 0 ? Math.min(1, (now - t0) / dur) : 1;
      window.scrollTo(0, from + (to - from) * ease(p));
      tweenRaf = p < 1 ? requestAnimationFrame(step) : 0;
    }
    tweenRaf = requestAnimationFrame(step);
  }
  function scrollWithAnim(top, anim) {
    if (anim === "无动画") {
      window.scrollTo(0, top);
      return;
    }
    var dur = clickDuration();
    if (anim === "淡化过渡") {
      var main = doc.querySelector(".blog-main") || doc.querySelector("main") || body;
      var half = Math.round(dur / 2);
      main.style.transition = "opacity " + half + "ms cubic-bezier(0.23, 1, 0.32, 1)";
      main.style.opacity = "0";
      window.setTimeout(function () {
        window.scrollTo(0, top);
        main.style.opacity = "1";
        window.setTimeout(function () {
          main.style.transition = "";
          main.style.opacity = "";
        }, half + 60);
      }, half);
      return;
    }
    tweenScroll(top, dur, easeOf());
  }

  /* ---------- 目录 ---------- */
  var toc = doc.querySelector(".blog-toc");
  if (toc) {
    var byId = {};
    Array.prototype.forEach.call(toc.querySelectorAll("a[href^='#']"), function (a) {
      try {
        byId[decodeURIComponent(a.getAttribute("href").slice(1))] = a;
      } catch (err) {}
    });

    /* 点按:捕获阶段接管(先于旧模板快照内联脚本的冒泡监听,避免双重滚动);
       自行滚动以给吸顶顶栏留出间距,原生 # 锚点跳转在标题被顶栏遮住时不可用 */
    doc.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest(".blog-toc a[href^='#']") : null;
      if (!a) return;
      var hash = a.getAttribute("href");
      var id = hash.slice(1);
      try { id = decodeURIComponent(id); } catch (err) {}
      var target = doc.getElementById(id);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      var bar = doc.querySelector(".blog-topbar");
      var gap = (bar ? bar.getBoundingClientRect().height : 0) + 24;
      var top = target.getBoundingClientRect().top + (window.pageYOffset || 0) - gap;
      var anim = body.getAttribute("data-toc-click") || "滑动";
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) anim = "无动画";
      scrollWithAnim(top < 0 ? 0 : top, anim);
      if (window.history && history.replaceState) history.replaceState(null, "", hash);
    }, true);

    /* 滚动高亮:最后一个滚过上沿 30% 线的标题;h1-h6 全层级
       (目录里存在的才参与。旧版只认 h2/h3,文章出现其他层级标题时目录永不点亮) */
    var headings = Array.prototype.slice.call(
      doc.querySelectorAll(
        ".blog-post-body h1[id], .blog-post-body h2[id], .blog-post-body h3[id]," +
          " .blog-post-body h4[id], .blog-post-body h5[id], .blog-post-body h6[id]"
      )
    ).filter(function (h) { return byId[h.id]; });
    if (headings.length) {
      var ticking = false;
      var update = function () {
        ticking = false;
        var line = window.innerHeight * 0.3;
        var activeId = "";
        for (var i = 0; i < headings.length; i++) {
          if (headings[i].getBoundingClientRect().top <= line) activeId = headings[i].id;
          else break;
        }
        Array.prototype.forEach.call(toc.querySelectorAll("a.current"), function (a) {
          a.classList.remove("current");
        });
        if (activeId && byId[activeId]) byId[activeId].classList.add("current");
      };
      var onScroll = function () {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      };
      /* 捕获级监听:视口与任何内部滚动容器的滚动都会触发;
         load/resize 后补算(图片与字体加载会改变标题位置) */
      doc.addEventListener("scroll", onScroll, { passive: true, capture: true });
      window.addEventListener("resize", onScroll, { passive: true });
      window.addEventListener("load", onScroll);
      update();
    }
  }

  /* ---------- 顶栏滚动态 ---------- */
  var tb = doc.querySelector(".blog-topbar");
  if (tb) {
    /* 顶栏变形(药丸/圆角矩形)单次触发:首次滚过阈值后永久保持变形态。
       此前随滚动阈值反复切换,过渡在中间帧被重启动画,观感上卡在某一处;
       单次触发后变形动画只播一次,不再重启。页面加载时已处于滚动位置
       (浏览器恢复阅读位置/刷新)的话,直接无过渡落位,不重播变形 */
    var at = parseInt(body.getAttribute("data-topbar-scroll-at") || "24", 10);
    if (!isFinite(at) || at < 0) at = 24;
    var y0 = window.scrollY || doc.documentElement.scrollTop || 0;
    if (y0 > at) {
      tb.style.transition = "none";
      tb.classList.add("is-scrolled");
      void tb.getBoundingClientRect();
      requestAnimationFrame(function () {
        tb.style.transition = "";
      });
    } else {
      var tbMorphed = false;
      var syncBar = function () {
        if (tbMorphed) return;
        if ((window.scrollY || doc.documentElement.scrollTop || 0) > at) {
          tbMorphed = true;
          tb.classList.add("is-scrolled");
        }
      };
      window.addEventListener("scroll", syncBar, { passive: true });
      syncBar();
    }
  }
  /* 文档主题顶栏:同一套滚动态标记,下拉变形形态由主题配置(data-topbar-shape)驱动 */
  var ptb = doc.querySelector(".ps-topbar");
  if (ptb) {
    var syncPTop = function () {
      ptb.classList.toggle("is-scrolled", (window.scrollY || doc.documentElement.scrollTop || 0) > 24);
    };
    window.addEventListener("scroll", syncPTop, { passive: true });
    syncPTop();
  }

  /* ---------- 置顶按钮:下滚出现,点击平滑回顶;与搜索入口同角时竖列并排 ---------- */
  if (body.getAttribute("data-backtop") === "true") {
    var pos = body.getAttribute("data-backtop-pos") === "页面左下角" ? "ps-bl" : "ps-br";
    var btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "ps-backtop " + pos;
    btn.setAttribute("aria-label", "回到顶部");
    btn.title = "回到顶部";
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>';
    body.appendChild(btn);
    var visible = false;
    var placeBtn = function () {
      var corner = window.__psSearchCorner;
      btn.classList.toggle("ps-stack", corner === (pos === "ps-br" ? "br" : "bl"));
    };
    var syncBtn = function () {
      var show = (window.scrollY || doc.documentElement.scrollTop || 0) > 420;
      if (show !== visible) {
        visible = show;
        btn.classList.toggle("is-visible", show);
        placeBtn();
      }
    };
    btn.addEventListener("click", function () {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        window.scrollTo(0, 0);
        return;
      }
      tweenScroll(0, clickDuration(), easeOf());
    });
    doc.addEventListener("scroll", syncBtn, { passive: true, capture: true });
    window.addEventListener("ps-search-ready", placeBtn);
    window.addEventListener("load", placeBtn);
    syncBtn();
    placeBtn();
  }

  /* ---------- 归档页:列表 / 分类 / 卡片流三种视图切换(无 JS 时默认显示列表) ---------- */
  var tabs = doc.querySelector(".blog-archive-tabs");
  if (tabs) {
    tabs.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("button[data-view]") : null;
      if (!btn) return;
      var view = btn.getAttribute("data-view");
      Array.prototype.forEach.call(tabs.querySelectorAll("button[data-view]"), function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      Array.prototype.forEach.call(doc.querySelectorAll(".blog-archive-pane"), function (pane) {
        pane.hidden = pane.getAttribute("data-pane") !== view;
      });
    });
  }

  /* ---------- 文件夹落地页:卡片流 / 目录视图切换 + 卡片标题筛选 + 排序 ---------- */
  var folder = doc.querySelector(".blog-folder");
  if (folder) {
    var ftabs = folder.querySelector(".blog-folder-tabs");
    if (ftabs) {
      ftabs.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest("button[data-fview]") : null;
        if (!btn) return;
        var view = btn.getAttribute("data-fview");
        Array.prototype.forEach.call(ftabs.querySelectorAll("button[data-fview]"), function (b) {
          b.classList.toggle("is-active", b === btn);
        });
        Array.prototype.forEach.call(folder.querySelectorAll(".blog-folder-pane"), function (pane) {
          pane.hidden = pane.getAttribute("data-fpane") !== view;
        });
      });
    }
    var filter = folder.querySelector(".blog-folder-filter");
    if (filter) {
      /* 标签筛选:从当前目录文章的标签汇总为药丸 chips,单选过滤;
         与文本筛选同时生效(卡片需同时满足两个条件才显示) */
      var stream = folder.querySelector('.blog-folder-pane[data-fpane="stream"] .blog-stream');
      var activeTag = "";
      var tagbar = doc.createElement("div");
      tagbar.className = "blog-folder-tagbar";
      filter.insertAdjacentElement("afterend", tagbar);
      var applyFilters = function () {
        var q = filter.value.trim().toLowerCase();
        Array.prototype.forEach.call(folder.querySelectorAll('.blog-folder-pane[data-fpane="stream"] .blog-entry'), function (card) {
          var text = (card.textContent || "").toLowerCase();
          var byText = !!q && text.indexOf(q) === -1;
          var names = " " + (card.getAttribute("data-tags") || "") + " ";
          var byTag = !!activeTag && names.indexOf(" " + activeTag + " ") === -1;
          card.classList.toggle("is-filtered", byText || byTag);
        });
      };
      if (stream) {
        var tagCount = {};
        var tagColorEl = {};
        Array.prototype.forEach.call(stream.querySelectorAll(".blog-entry"), function (card) {
          var names = [];
          Array.prototype.forEach.call(card.querySelectorAll(".blog-entry-tag[data-tag]"), function (pill) {
            var n = pill.getAttribute("data-tag");
            if (!n) return;
            names.push(n);
            tagCount[n] = (tagCount[n] || 0) + 1;
            if (!tagColorEl[n] && pill.style.getPropertyValue("--tag-c")) tagColorEl[n] = pill.style.getPropertyValue("--tag-c");
          });
          if (names.length) card.setAttribute("data-tags", names.join(" "));
        });
        var chips = [];
        var makeChip = function (label, tag, color) {
          var chip = doc.createElement("button");
          chip.type = "button";
          chip.className = "blog-folder-tagchip";
          chip.textContent = label;
          if (color) chip.style.setProperty("--tag-c", color);
          chip.addEventListener("click", function () {
            activeTag = activeTag === tag ? "" : tag;
            Array.prototype.forEach.call(chips, function (c) {
              c.classList.toggle("is-active", c === chip && !!activeTag);
            });
            applyFilters();
          });
          chips.push(chip);
          return chip;
        };
        Object.keys(tagCount).forEach(function (n) {
          tagbar.appendChild(makeChip(n, n, tagColorEl[n]));
        });
        filter.addEventListener("input", applyFilters);
      }

      /* 排序:默认 / 更新日期 / 发布日期 / 标题,方向按钮切正倒序。
         排序在筛选之后仍成立(筛选是 class 状态,不随重排丢失) */
      var stream = folder.querySelector('.blog-folder-pane[data-fpane="stream"] .blog-stream');
      if (stream) {
        var cardsInOrder = Array.prototype.slice.call(stream.querySelectorAll(":scope > .blog-entry"));
        var sortBar = doc.createElement("div");
        sortBar.className = "blog-folder-sort";
        var sortSel = doc.createElement("select");
        sortSel.className = "blog-folder-sort-select";
        sortSel.setAttribute("aria-label", "排序方式");
        [
          ["default", "默认排序"],
          ["updated", "按更新日期"],
          ["date", "按发布日期"],
          ["title", "按标题"],
        ].forEach(function (item) {
          var opt = doc.createElement("option");
          opt.value = item[0];
          opt.textContent = item[1];
          sortSel.appendChild(opt);
        });
        var sortDir = doc.createElement("button");
        sortDir.type = "button";
        sortDir.className = "blog-folder-sort-dir";
        sortDir.textContent = "↓";
        sortDir.title = "切换正序 / 倒序";
        sortDir.setAttribute("aria-label", "切换正序 / 倒序");
        sortBar.appendChild(sortSel);
        sortBar.appendChild(sortDir);
        filter.insertAdjacentElement("afterend", sortBar);

        var titleOf = function (card) {
          var t = card.querySelector(".blog-entry-title");
          return (t ? t.textContent : card.textContent || "").trim();
        };
        var keyOf = {
          updated: function (card) { return Number(card.getAttribute("data-updated") || 0); },
          // date 可能是 2026-9-1 这类非零填充写法:斜杠化交给 Date 解析
          date: function (card) {
            var d = new Date(String(card.getAttribute("data-date") || "").replace(/-/g, "/"));
            return isNaN(d.getTime()) ? 0 : d.getTime();
          },
          title: function (card) { return titleOf(card); },
        };
        var applySort = function () {
          var mode = sortSel.value;
          var desc = sortDir.textContent === "↓";
          var ordered = cardsInOrder.slice();
          if (mode !== "default") {
            var key = keyOf[mode];
            ordered.sort(function (a, b) {
              var ka = key(a);
              var kb = key(b);
              var r = typeof ka === "string" ? ka.localeCompare(kb, "zh-Hans-CN") : ka - kb;
              return desc ? -r : r;
            });
          }
          ordered.forEach(function (card) { stream.appendChild(card); });
        };
        sortSel.addEventListener("change", applySort);
        sortDir.addEventListener("click", function () {
          sortDir.textContent = sortDir.textContent === "↓" ? "↑" : "↓";
          applySort();
        });
      }
    }
  }

  /* ---------- 移动端顶栏目录:按钮展开导航面板(≤640px,主题开关) ---------- */
  var mnavBtn = doc.querySelector(".blog-mnav-btn");
  var mnav = doc.querySelector(".blog-mnav");
  if (mnavBtn && mnav) {
    var setMnav = function (open) {
      mnav.setAttribute("data-open", String(open));
      mnavBtn.setAttribute("aria-expanded", String(open));
    };
    mnavBtn.addEventListener("click", function () {
      setMnav(mnav.getAttribute("data-open") !== "true");
    });
    mnav.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest("a")) setMnav(false);
    });
    doc.addEventListener("click", function (e) {
      if (mnav.getAttribute("data-open") !== "true") return;
      var t = e.target;
      if (t && t.closest && (t.closest(".blog-mnav") || t.closest(".blog-mnav-btn"))) return;
      setMnav(false);
    });
  }

  /* ---------- 加载指示 ---------- */
  var loader = doc.querySelector(".ps-loader");
  if (loader) {
    var finishLoader = function () {
      loader.classList.add("is-done");
      window.setTimeout(function () { loader.remove(); }, 420);
    };
    if (doc.readyState === "complete") finishLoader();
    else window.addEventListener("load", finishLoader);
  }
})();
