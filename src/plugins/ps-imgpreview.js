/* 素构 · 图片预览插件
 * 点击正文图片进入灯箱:从源图位置展开(关闭时原路返回),滚轮/双指/双击缩放,
 * 拖拽 1:1 平移并带惯性,±90° 旋转,同源下载;Esc/背景点击关闭。 */
(function () {
  "use strict";
  if (window.__psImgPreview) return;
  window.__psImgPreview = true;

  var lang = (document.documentElement.lang || "zh-CN").toLowerCase();
  var zh = lang.indexOf("zh") === 0;
  var T = {
    zoomIn: zh ? "放大" : "Zoom in",
    zoomOut: zh ? "缩小" : "Zoom out",
    reset: zh ? "重置缩放" : "Reset zoom",
    rotate: zh ? "旋转 90°" : "Rotate 90°",
    download: zh ? "下载图片" : "Download image",
    close: zh ? "关闭" : "Close",
    dialog: zh ? "图片预览" : "Image preview",
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
    download: '<path d="M12 4v11"/><path d="M7 11l5 4.5 5-4.5"/><path d="M5 20h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  function svg(path) {
    return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + path + "</svg>";
  }

  /* ---------- 可预览判定:正文容器内的图片,排除链接/导航/小图标 ---------- */
  function zoomable(target) {
    var im = target && target.tagName === "IMG" ? target : null;
    if (!im || !im.getAttribute("src") || im.getAttribute("data-ps-nozoom") !== null) return false;
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

    document.documentElement.style.overflow = "hidden";
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
        // FLIP:先摆到源图的位置与尺寸,再迁移到居中适配位
        st.scale = 1;
        st.tx = 0;
        st.ty = 0;
        st.rot = 0;
        apply();
        var from = im.getBoundingClientRect();
        var to = img.getBoundingClientRect();
        if (from.width && to.width) {
          var s = Math.min(from.width / to.width, from.height / to.height);
          st.tx = from.left + from.width / 2 - window.innerWidth / 2;
          st.ty = from.top + from.height / 2 - window.innerHeight / 2;
          st.scale = s;
        }
        apply();
        requestAnimationFrame(function () {
          st.scale = 1;
          st.tx = 0;
          st.ty = 0;
          apply();
        });
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
    document.removeEventListener("keydown", onKey, true);
    var done = function () {
      overlay.remove();
      document.documentElement.style.overflow = "";
      if (sourceImg) sourceImg.style.visibility = "";
      sourceImg = null;
    };
    overlay.classList.remove("ps-open");
    var back = sourceImg && !reduced ? sourceImg.getBoundingClientRect() : null;
    var visible = back && back.bottom > 0 && back.top < window.innerHeight && back.width > 0;
    if (visible) {
      // 空间一致:沿来路返回源图位置,而不是原地消散
      setMode(null);
      var s = Math.min(back.width / img.getBoundingClientRect().width, back.height / img.getBoundingClientRect().height);
      st.tx = back.left + back.width / 2 - window.innerWidth / 2;
      st.ty = back.top + back.height / 2 - window.innerHeight / 2;
      st.scale = s;
      apply();
      window.setTimeout(done, 580);
    } else {
      done();
    }
  }

  /* ---------- 工具条 ---------- */
  var scaleBtn = null;
  function buildBar(host) {
    var bar = document.createElement("div");
    bar.className = "ps-lb-bar";
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
      st.rot = (st.rot + 90) % 360;
      apply();
    });
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
    bar.append(out, scaleBtn, inn, sep1, rot, dl, sep2, x);
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
  var drag = null; // { baseX, baseY, st0, samples, moved, downT, downX, downY, pinch0, pinchDist0 }
  var lastTap = 0;

  function onDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      drag = {
        baseX: e.clientX,
        baseY: e.clientY,
        st0: { scale: st.scale, tx: st.tx, ty: st.ty },
        samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }],
        moved: false,
        downT: e.timeStamp,
        downX: e.clientX,
        downY: e.clientY,
      };
      overlay.setPointerCapture(e.pointerId);
      overlay.addEventListener("pointermove", onMove);
      overlay.addEventListener("pointerup", onUp);
      overlay.addEventListener("pointercancel", onUp);
      setMode("ps-lb-dragging");
    } else if (pointers.size === 2) {
      var pts = [...pointers.values()];
      drag.pinch0 = st.scale;
      drag.pinchDist0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) return;
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
    if (Math.abs(dx) + Math.abs(dy) > 8) drag.moved = true;
    st.tx = drag.st0.tx + dx;
    st.ty = drag.st0.ty + dy;
    apply();
    drag.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (drag.samples.length > 6) drag.samples.shift();
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size > 0) {
      if (pointers.size === 1) {
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

    if (d && !d.moved && e.timeStamp - d.downT < 400) {
      // 未移动的点击:双击图片切换 100% ↔ 250%(以点击点为中心);背景单击由 mousedown 关闭
      if (e.target === img) {
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
    if (d && d.samples.length >= 2) {
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
      st.rot = (st.rot + 90) % 360;
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
