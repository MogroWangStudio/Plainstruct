/* 素构 · 图片预览插件
 * 点击正文图片进入灯箱:从源图位置展开(关闭时原路返回),滚轮/双指/双击缩放,
 * 拖拽 1:1 平移并带惯性,±90° 旋转,同源下载;Esc/背景点击关闭。 */
(function () {
  "use strict";
  // 防重入以「标记元素」为标志:预览的 document.write 重写复用同一个
  // document 对象,但 DOM 被清空 —— 标记元素随重写消失,据此重新初始化
  if (document.getElementById("ps-imgpreview-init")) return;
  var initMark = document.createElement("div");
  initMark.id = "ps-imgpreview-init";
  initMark.style.display = "none";
  (document.body || document.documentElement).appendChild(initMark);

  var lang = (document.documentElement.lang || "zh-CN").toLowerCase();
  var zh = lang.indexOf("zh") === 0;
  var T = {
    zoomIn: zh ? "放大" : "Zoom in",
    zoomOut: zh ? "缩小" : "Zoom out",
    reset: zh ? "重置缩放" : "Reset zoom",
    rotate: zh ? "旋转 90°" : "Rotate 90°",
    pixelOn: zh ? "切换为抗锯齿渲染" : "Switch to smooth rendering",
    pixelOff: zh ? "切换为像素渲染" : "Switch to pixel rendering",
    download: zh ? "下载图片" : "Download image",
    close: zh ? "关闭" : "Close",
    dialog: zh ? "图片预览" : "Image preview",
    unknownSize: zh ? "未知" : "Unknown",
  };

  var MIN = 0.2;
  var MAX = 8;
  var st = { scale: 1, tx: 0, ty: 0, rot: 0 };
  var overlay, img;
  var sourceImg = null; // 打开时的源图(隐藏,关闭时恢复)
  var opened = false;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var ICON = {
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    rotate: '<path d="M20 5v5h-5"/><path d="M20 10a8 8 0 1 0 1.7 6"/>',
    pixel: '<path d="M4 4h5v5H4z"/><path d="M15 4h5v5h-5z"/><path d="M9.5 9.5h5v5h-5z"/><path d="M4 15h5v5H4z"/><path d="M15 15h5v5h-5z"/>',
    download: '<path d="M12 4v11"/><path d="M7 11l5 4.5 5-4.5"/><path d="M5 20h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  function svg(path) {
    return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + path + "</svg>";
  }

  /* ---------- 可预览判定:正文容器内的图片,排除链接/导航/小图标 ---------- */
  // 标记模式:插件 script 带 data-require-mark 时,仅 class 含该标记(如
  // mws_ps_imgpreview)的图片可点击预览;缺省对全部正文图片生效
  var requireMark = "";
  (function () {
    var me = document.currentScript;
    if (!me) {
      var scripts = document.querySelectorAll("script[data-require-mark]");
      me = scripts[scripts.length - 1] || null;
    }
    if (me) requireMark = (me.getAttribute("data-require-mark") || "").trim();
  })();
  // 内联注入通道(mock 预览):壳层经 window.__psImgRequireMark 传入标记
  if (typeof window.__psImgRequireMark === "string") requireMark = window.__psImgRequireMark.trim();

  /* 标记模式下的光标:未带标记的图片不提示可预览(悬停光标不变),带标记的
     仍显 zoom-in,链接内图片保持 pointer。注入到主题样式之后,优先级按
     文档顺序压过默认的 main img 规则 */
  var markToken = requireMark.replace(/[^A-Za-z0-9_-]/g, "");
  if (markToken) {
    var cursorStyle = document.createElement("style");
    cursorStyle.id = "ps-imgpreview-cursor";
    cursorStyle.textContent =
      "main img,article img{cursor:auto}" +
      "main img." + markToken + ",main ." + markToken + " img,article img." + markToken + ",article ." + markToken + " img{cursor:zoom-in}" +
      "main a img,article a img{cursor:pointer}";
    (document.head || document.documentElement).appendChild(cursorStyle);
  }

  /* 移动端禁用网页缩放:双指捏合与双击放大交给灯箱内部手势,页面本身的
     缩放反而让图片「放大不动」。viewport 收紧缩放能力;iOS 不理会
     user-scalable=no,再以 gesturestart 捕获阶段拦下手势事件 */
  (function () {
    var vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement("meta");
      vp.name = "viewport";
      (document.head || document.documentElement).appendChild(vp);
    }
    var keep = (vp.getAttribute("content") || "").replace(/user-scalable\s*=[^,]*,?/gi, "").replace(/maximum-scale\s*=[^,]*,?/gi, "").replace(/,\s*$/, "");
    vp.setAttribute("content", keep + (keep ? ", " : "") + "maximum-scale=1, user-scalable=no");
  })();
  document.addEventListener("gesturestart", function (e) {
    e.preventDefault();
  }, { passive: false });

  function zoomable(target) {
    var im = target && target.tagName === "IMG" ? target : null;
    if (!im || !im.getAttribute("src") || im.getAttribute("data-ps-nozoom") !== null) return false;
    if (requireMark) {
      var token = requireMark.replace(/[^A-Za-z0-9_-]/g, "");
      var own = " " + im.className + " ";
      var inMarked = own.indexOf(" " + requireMark + " ") !== -1 || (token && im.closest("." + token));
      if (!inMarked) return false;
    }
    if (im.closest("a, header, nav, footer, aside, button")) return false;
    if (!im.closest("main, article, .ps-main, .blog-main, .blog-post-body")) return false;
    var r = im.getBoundingClientRect();
    return r.width >= 48 && r.height >= 48;
  }

  /* ---------- 应用当前变换 ---------- */
  function apply() {
    img.style.transform =
      "translate(-50%,-50%) translate(" + st.tx + "px," + st.ty + "px) scale(" + st.scale + ") rotate(" + st.rot + "deg)";
    if (scaleBtn) scaleBtn.textContent = Math.round(st.scale * 100) + "%";
  }

  /** 以视口点 p 为缩放中心改变倍率(保持该点下的内容不动) */
  function zoomAt(px, py, next) {
    var s = Math.min(MAX, Math.max(MIN, next));
    var k = s / st.scale;
    var cx = window.innerWidth / 2 + st.tx;
    var cy = window.innerHeight / 2 + st.ty;
    st.tx = px - (px - cx) * k - window.innerWidth / 2;
    st.ty = py - (py - cy) * k - window.innerHeight / 2;
    st.scale = s;
    apply();
  }

  function setMode(cls) {
    img.classList.remove("ps-lb-spring", "ps-lb-dragging");
    if (cls) img.classList.add(cls);
  }

  /* ---------- 打开/关闭 ---------- */
  function open(im) {
    if (opened) return;
    opened = true;
    sourceImg = im;
    im.style.visibility = "hidden";

    overlay = document.createElement("div");
    overlay.id = "ps-lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", T.dialog);
    img = document.createElement("img");
    img.className = "ps-lb-img";
    img.alt = im.alt || "";
    img.src = im.currentSrc || im.src;
    overlay.appendChild(img);
    buildBar(overlay);
    document.body.appendChild(overlay);

    // 背景滚动锁定:预览时移动端拖动只作用于图片 —— 锁定视口滚动与
    // 页面里全部可滚动容器(触摸平移的目标链),关闭时恢复
    lockedScroll = [];
    var n = document.scrollingElement || document.documentElement;
    lockedScroll.push({ el: n, y: n.scrollTop, x: n.scrollLeft });
    document.documentElement.style.overflow = "hidden";
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var cs = getComputedStyle(all[i]);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && all[i].scrollHeight > all[i].clientHeight) {
        lockedScroll.push({ el: all[i], y: all[i].scrollTop, x: all[i].scrollLeft });
        all[i].style.overflow = "hidden";
      }
    }
    buildMeta(overlay, im);
    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) close();
    });
    overlay.addEventListener("wheel", onWheel, { passive: false });
    overlay.addEventListener("pointerdown", onDown);
    overlay.addEventListener("dblclick", function (e) {
      e.preventDefault();
    });

    var showNow = function () {
      requestAnimationFrame(function () {
        overlay.classList.add("ps-open");
        if (reduced) {
          apply();
          return;
        }
        // FLIP:先无过渡摆到源图的位置与尺寸(基尺寸用布局值,避免测到过渡中间帧),
        // 强制回流让起点生效,再切长曲线迁移到居中适配位
        setMode("ps-lb-dragging");
        st.scale = 1;
        st.tx = 0;
        st.ty = 0;
        st.rot = 0;
        img.style.boxShadow = "none"; // 从源图的无阴影状态起飞
        apply();
        var from = im.getBoundingClientRect();
        var baseW = img.offsetWidth || 1;
        var baseH = img.offsetHeight || 1;
        if (from.width && baseW) {
          st.scale = Math.min(from.width / baseW, from.height / baseH);
          st.tx = from.left + from.width / 2 - window.innerWidth / 2;
          st.ty = from.top + from.height / 2 - window.innerHeight / 2;
        }
        apply();
        img.getBoundingClientRect();
        setMode(null);
        img.style.boxShadow = ""; // 阴影随升空逐渐浮现
        st.scale = 1;
        st.tx = 0;
        st.ty = 0;
        apply();
      });
    };
    if (img.complete && img.naturalWidth) showNow();
    else {
      img.onload = showNow;
      img.onerror = function () {
        showNow();
      };
    }
  }

  function close() {
    if (!opened) return;
    opened = false;
    pointers.clear();
    drag = null;
    document.removeEventListener("keydown", onKey, true);
    var done = function () {
      overlay.remove();
      document.documentElement.style.overflow = "";
      for (var i = 0; i < lockedScroll.length; i++) {
        lockedScroll[i].el.style.overflow = "";
      }
      lockedScroll = [];
      if (sourceImg) sourceImg.style.visibility = "";
      sourceImg = null;
    };
    overlay.classList.remove("ps-open");
    var back = sourceImg && !reduced ? sourceImg.getBoundingClientRect() : null;
    var visible = back && back.bottom > 0 && back.top < window.innerHeight && back.width > 0;
    if (visible) {
      // 空间一致:沿来路返回源图位置。基尺寸取 offsetWidth(布局尺寸,不受当前
      // transform 影响;getBoundingClientRect 会带上 scale 导致二次缩放跳变),
      // 旋转在返回途中收正到最近的整圈,落地时与源图朝向一致
      setMode(null);
      var baseW = img.offsetWidth || 1;
      var baseH = img.offsetHeight || 1;
      st.scale = Math.min(back.width / baseW, back.height / baseH);
      st.tx = back.left + back.width / 2 - window.innerWidth / 2;
      st.ty = back.top + back.height / 2 - window.innerHeight / 2;
      st.rot = Math.round(st.rot / 360) * 360;
      // 阴影随归位逐渐淡去(过渡由 CSS 同曲线接管),落地时与页面融为一体
      img.style.boxShadow = "none";
      apply();
      window.setTimeout(done, 580);
    } else {
      done();
    }
  }

  /* ---------- 图片信息条:文件名 + 分辨率 + 文件大小 ---------- */
  var lockedScroll = [];

  function buildMeta(host, im) {
    var name = decodeURIComponent((im.currentSrc || im.src).split("?")[0].split("#")[0].split("/").pop() || "");
    var meta = document.createElement("div");
    meta.className = "ps-lb-meta";
    var parts = [name];
    // 分辨率:等加载完成后回填(打开时通常已缓存)
    var nat = im.naturalWidth + "×" + im.naturalHeight;
    if (im.naturalWidth) parts.push(nat);
    else {
      parts.push(T.unknownSize);
      var probe = new Image();
      probe.onload = function () {
        var dim = probe.naturalWidth + "×" + probe.naturalHeight;
        meta.dataset.dim = dim;
        refreshMeta(meta);
      };
      probe.src = im.currentSrc || im.src;
    }
    // 文件大小:同源资源用 HEAD 读 content-length(页面相对路径均同源);拿不到就不显示
    var sameOrigin = true;
    try {
      sameOrigin = new URL(im.currentSrc || im.src, location.href).origin === location.origin;
    } catch (e) { /* 解析失败按同源处理 */ }
    if (sameOrigin && wFetch) {
      wFetch(im.currentSrc || im.src, { method: "HEAD" })
        .then(function (r) {
          var len = parseInt(r.headers.get("content-length") || "", 10);
          if (Number.isFinite(len) && len > 0) {
            meta.dataset.size = len >= 1048576 ? (len / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(len / 1024)) + " KB";
            refreshMeta(meta);
          }
        })
        .catch(function () { /* 大小不可得,仅省略 */ });
    }
    function refreshMeta(m) {
      var seg = [name];
      if (m.dataset.dim) seg.push(m.dataset.dim);
      if (m.dataset.size) seg.push(m.dataset.size);
      m.textContent = seg.join(" · ");
    }
    meta.textContent = parts.join(" · ");
    host.appendChild(meta);
  }

  /* ---------- 工具条 ---------- */
  var scaleBtn = null;
  var wFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  function buildBar(host) {
    var bar = document.createElement("div");
    bar.className = "ps-lb-bar";
    var pixel = false; // 本次预览的渲染方式:false = 抗锯齿(默认),true = 像素
    var out = btn(ICON.minus, T.zoomOut, function () {
      setMode("ps-lb-spring");
      zoomAt(window.innerWidth / 2, window.innerHeight / 2, st.scale / 1.5);
    });
    scaleBtn = btn("", T.reset, function () {
      setMode("ps-lb-spring");
      st.scale = 1;
      st.tx = 0;
      st.ty = 0;
      apply();
    });
    scaleBtn.classList.add("ps-lb-scale");
    var inn = btn(ICON.plus, T.zoomIn, function () {
      setMode("ps-lb-spring");
      zoomAt(window.innerWidth / 2, window.innerHeight / 2, st.scale * 1.5);
    });
    var sep1 = document.createElement("span");
    sep1.className = "ps-lb-sep";
    var rot = btn(ICON.rotate, T.rotate, function () {
      setMode("ps-lb-spring");
      st.rot += 90; // 累积角度:取模会让 270°→0° 沿原路倒转一大圈
      apply();
    });
    // 渲染方式:像素放大(关闭插值,像素网格清晰)与抗锯齿放大(默认)切换
    var pixelBtn = btn(ICON.pixel, T.pixelOff, function () {
      pixel = !pixel;
      img.style.imageRendering = pixel ? "pixelated" : "";
      pixelBtn.classList.toggle("is-active", pixel);
      pixelBtn.title = pixel ? T.pixelOn : T.pixelOff;
      pixelBtn.setAttribute("aria-pressed", String(pixel));
    });
    pixelBtn.setAttribute("aria-pressed", "false");
    var dl = btn(ICON.download, T.download, function () {
      var name = decodeURIComponent((img.src.split("?")[0].split("#")[0].split("/").pop() || "image"));
      var a = document.createElement("a");
      a.href = img.src;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    var sep2 = document.createElement("span");
    sep2.className = "ps-lb-sep";
    var x = btn(ICON.close, T.close, close);
    bar.append(out, scaleBtn, inn, sep1, rot, pixelBtn, dl, sep2, x);
    bar.addEventListener("mousedown", function (e) {
      e.stopPropagation(); // 工具条上的点击不触发背景关闭
    });
    host.appendChild(bar);
  }
  function btn(path, title, fn) {
    var b = document.createElement("button");
    b.className = "ps-lb-btn";
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    if (path) b.innerHTML = svg(path);
    b.addEventListener("click", fn);
    return b;
  }

  /* ---------- 手势:滚轮 / 拖拽 / 双指 / 双击 ---------- */
  function onWheel(e) {
    e.preventDefault();
    setMode("ps-lb-spring");
    var k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    zoomAt(e.clientX, e.clientY, st.scale * k);
  }

  var pointers = new Map();
  var drag = null; // { baseX, baseY, st0, samples, moved, locked, downT, downX, downY, downTarget, pinch0, pinchDist0 }
  var lastTap = 0;

  function onDown(e) {
    // 工具条上的按下完全豁免:不登记指针、不捕获 —— 按钮的 pointer 事件
    // 保持原生路径,click 正常派发(此前立即捕获把点击重定向到了遮罩,按钮全部失效)
    if (e.target.closest && e.target.closest(".ps-lb-bar")) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      drag = {
        baseX: e.clientX,
        baseY: e.clientY,
        st0: { scale: st.scale, tx: st.tx, ty: st.ty },
        samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }],
        moved: false,
        locked: false,
        downT: e.timeStamp,
        downX: e.clientX,
        downY: e.clientY,
        // 捕获后后续事件的 target 会被重定向到遮罩,按下时的原始目标留作点击判定
        downTarget: e.target,
      };
      overlay.addEventListener("pointermove", onMove);
      overlay.addEventListener("pointerup", onUp);
      overlay.addEventListener("pointercancel", onUp);
    } else if (pointers.size === 2 && drag) {
      var pts = [...pointers.values()];
      drag.pinch0 = st.scale;
      drag.pinchDist0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId) || !drag) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var pts = [...pointers.values()];
    if (pts.length >= 2 && drag.pinchDist0) {
      // 双指:中点为缩放中心,距离比驱动倍率
      var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      var prev = st.scale;
      zoomAt(mid.x, mid.y, drag.pinch0 * (dist / drag.pinchDist0));
      drag.st0 = { scale: st.scale, tx: st.tx, ty: st.ty };
      drag.baseX = mid.x;
      drag.baseY = mid.y;
      if (prev !== st.scale) drag.moved = true;
      return;
    }
    var dx = e.clientX - drag.baseX;
    var dy = e.clientY - drag.baseY;
    if (!drag.locked) {
      // 越过位移阈值才锁定手势并捕获指针:点击/双击不被劫持,按钮与图片各归其位
      if (Math.abs(dx) + Math.abs(dy) <= 8) return;
      drag.locked = true;
      drag.moved = true;
      try {
        overlay.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 捕获失败按未捕获继续 */
      }
      setMode("ps-lb-dragging");
    }
    st.tx = drag.st0.tx + dx;
    st.ty = drag.st0.ty + dy;
    apply();
    drag.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (drag.samples.length > 6) drag.samples.shift();
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size > 0) {
      if (pointers.size === 1 && drag) {
        // 双指抬起一指:以剩余指为新的拖拽起点,手势连续不跳变
        var rest = [...pointers.values()][0];
        drag.baseX = rest.x;
        drag.baseY = rest.y;
        drag.st0 = { scale: st.scale, tx: st.tx, ty: st.ty };
        drag.pinchDist0 = 0;
      }
      return;
    }
    overlay.removeEventListener("pointermove", onMove);
    overlay.removeEventListener("pointerup", onUp);
    overlay.removeEventListener("pointercancel", onUp);
    var d = drag;
    drag = null;
    if (!d) return;

    if (!d.locked && e.timeStamp - d.downT < 400) {
      // 未移动的点击:双击图片切换 100% ↔ 250%(以点击处为中心);背景单击由 mousedown 关闭
      if (d.downTarget === img) {
        var now2 = e.timeStamp;
        if (now2 - lastTap < 320) {
          setMode("ps-lb-spring");
          if (st.scale > 1.3) {
            st.scale = 1;
            st.tx = 0;
            st.ty = 0;
          } else {
            var target = 2.5;
            var k = target / st.scale;
            var cx = window.innerWidth / 2 + st.tx;
            var cy = window.innerHeight / 2 + st.ty;
            st.tx = e.clientX - (e.clientX - cx) * k - window.innerWidth / 2;
            st.ty = e.clientY - (e.clientY - cy) * k - window.innerHeight / 2;
            st.scale = target;
          }
          apply();
          lastTap = 0;
          return;
        }
        lastTap = now2;
      }
      setMode("ps-lb-spring");
      return;
    }

    // 拖拽释放:交接释放速度做惯性衰减
    setMode("ps-lb-spring");
    if (d.samples.length >= 2) {
      var a = d.samples[d.samples.length - 2];
      var b = d.samples[d.samples.length - 1];
      var dt = b.t - a.t;
      if (dt > 0 && dt < 80) {
        var vx = (b.x - a.x) / dt;
        var vy = (b.y - a.y) / dt;
        if (Math.hypot(vx, vy) > 0.05) inertia(vx, vy);
      }
    }
  }

  function inertia(vx, vy) {
    var last = performance.now();
    var step = function (now) {
      var dt = now - last;
      last = now;
      st.tx += vx * dt;
      st.ty += vy * dt;
      var decay = Math.pow(0.94, dt / 16.7);
      vx *= decay;
      vy *= decay;
      apply();
      if (opened && Math.hypot(vx, vy) > 0.02) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- 键盘 ---------- */
  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "+" || e.key === "=") {
      setMode("ps-lb-spring");
      zoomAt(window.innerWidth / 2, window.innerHeight / 2, st.scale * 1.4);
    } else if (e.key === "-" || e.key === "_") {
      setMode("ps-lb-spring");
      zoomAt(window.innerWidth / 2, window.innerHeight / 2, st.scale / 1.4);
    } else if (e.key === "0") {
      setMode("ps-lb-spring");
      st.scale = 1;
      st.tx = 0;
      st.ty = 0;
      apply();
    } else if (e.key === "r" || e.key === "R") {
      setMode("ps-lb-spring");
      st.rot += 90; // 累积角度:取模会让 270°→0° 沿原路倒转一大圈
      apply();
    } else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      setMode("ps-lb-dragging");
      var step = 40;
      if (e.key === "ArrowLeft") st.tx -= step;
      else if (e.key === "ArrowRight") st.tx += step;
      else if (e.key === "ArrowUp") st.ty -= step;
      else st.ty += step;
      apply();
      setMode("ps-lb-spring");
    }
  }

  /* ---------- 事件委托:点击正文图片即进入预览 ---------- */
  document.addEventListener(
    "click",
    function (e) {
      if (!zoomable(e.target)) return;
      e.preventDefault();
      open(e.target);
    },
    true,
  );
})();
