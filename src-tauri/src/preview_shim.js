/** 素构预览注入脚本 —— site:// 协议返回 HTML 时动态注入,构建产物本身不含此文件。
 *  平时完全沉默;独立预览窗口的壳层(preview.html)经 postMessage 激活后:
 *  - 向壳层回报页面导航状态(地址、标题、会话深度),驱动地址栏与前进/后退按钮;
 *  - 移动模式:把指针事件镜像为真实触摸事件送达页面(触摸流与鼠标流并存,
 *    与真机一致);支持安卓左缘侧滑返回 —— 1:1 跟手、速度采样,位移与松手
 *    速度共同决定提交/取消,滑动动画由壳层驱动,本脚本只负责手势裁决。
 *  编辑器内嵌预览不会收到激活消息,注入后保持沉默,行为不受影响。 */
(function () {
  "use strict";
  if (window.__psPreviewShim) return;
  window.__psPreviewShim = true;

  var EDGE = 28;          // 左缘手势判定区宽度(px)
  var EDGE_SAFE = 8;      // 手势区上/下留白(px)
  var START_DELTA = 10;   // 横向越过该位移才算手势(方向锁阈值)
  var COMMIT_RATIO = 0.5; // 滑过屏宽该比例,松手提交返回
  var FLING_VX = 600;     // 松手右向速度超过该值(px/s),位移不足也提交

  var mode = null;        // null | "desktop" | "mobile"(壳层激活后才有值)
  var depth = 1;          // 当前条目在 iframe 会话历史中的深度
  var gesture = null;     // 进行中的侧滑手势
  var touchTarget = null; // 触摸镜像:一次按下的起始目标(一次触摸全程派发给它)

  function post(msg) {
    try {
      window.parent.postMessage(msg, "*");
    } catch (e) {
      /* 父级不可达时静默 */
    }
  }

  /* ---------- 会话深度与页面回报 ---------- */

  // 深度记在 history.state(psd)上:新建条目取「历史最大深度 + 1」,
  // 后退/前进/刷新复用条目上的旧值,无须区分方向,也不受 bfcache 恢复影响。
  function trackDepth() {
    var st = null;
    try {
      st = history.state;
    } catch (e) {
      /* 忽略 */
    }
    if (st && typeof st.psd === "number") return st.psd;
    var max = 0;
    try {
      max = Number(sessionStorage.getItem("psDepthMax")) || 0;
    } catch (e) {
      /* 忽略 */
    }
    depth = max + 1;
    try {
      sessionStorage.setItem("psDepthMax", String(depth));
      history.replaceState(Object.assign({}, st, { psd: depth }), "");
    } catch (e) {
      /* 状态不可写时按本地深度继续 */
    }
    return depth;
  }

  function navType() {
    try {
      var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
      if (nav && nav.type) return nav.type; // navigate | back_forward | reload
    } catch (e) {
      /* 忽略 */
    }
    return "navigate";
  }

  function reportPage() {
    depth = trackDepth();
    post({
      source: "ps-shim",
      type: "page",
      nav: navType(),
      depth: depth,
      url: location.href,
      title: document.title,
    });
  }

  /* ---------- 触摸镜像:指针事件 → 真实触摸事件 ---------- */

  function dispatch(e, type, target) {
    if (typeof Touch !== "function" || typeof TouchEvent !== "function") return;
    var t;
    try {
      t = new Touch({
        identifier: e.pointerId || 1,
        target: target,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        pageX: e.pageX,
        pageY: e.pageY,
        radiusX: 1,
        radiusY: 1,
        rotationAngle: 0,
        force: e.pressure > 0 ? e.pressure : 0.5,
      });
    } catch (err) {
      return;
    }
    var touches = type === "touchend" || type === "touchcancel" ? [] : [t];
    try {
      target.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          touches: touches,
          targetTouches: touches,
          changedTouches: [t],
        }),
      );
    } catch (err) {
      /* 目标已脱离文档等情况忽略 */
    }
  }

  function mirror(e) {
    if (mode !== "mobile") return;
    if (gesture && gesture.locked) return; // 侧滑手势接管期间不镜像
    if (e.pointerType && e.pointerType !== "mouse") return; // 真实触摸不重复镜像
    if (e.type === "pointerdown") {
      if (e.button !== 0) return;
      touchTarget = e.target || document.body;
      dispatch(e, "touchstart", touchTarget);
      return;
    }
    if (!touchTarget) return; // 未按下:悬停移动不产生触摸
    if (e.type === "pointermove") {
      dispatch(e, "touchmove", touchTarget);
    } else if (e.type === "pointerup") {
      dispatch(e, "touchend", touchTarget);
      touchTarget = null;
    } else if (e.type === "pointercancel") {
      dispatch(e, "touchcancel", touchTarget);
      touchTarget = null;
    }
  }

  /* ---------- 安卓左缘侧滑返回 ---------- */

  function sideProgress(dx) {
    var w = window.innerWidth;
    if (depth > 1) {
      var p = dx / w;
      return p < 0 ? 0 : p > 1 ? 1 : p;
    }
    // 无历史可退:渐进阻尼的「到底」回馈(苹果 rubber-band 公式),最多让出一条缝
    if (dx <= 0) return 0;
    var c = 0.55;
    return ((dx * w * c) / (w + c * dx)) / w;
  }

  function sampleVelocity(hist) {
    if (hist.length < 2) return 0;
    var first = hist[0];
    var last = hist[hist.length - 1];
    var dt = last.t - first.t;
    return dt > 0 ? ((last.x - first.x) / dt) * 1000 : 0;
  }

  function endGesture(commit) {
    var g = gesture;
    gesture = null;
    if (!g || !g.locked) return;
    document.body.style.userSelect = "";
    post({
      source: "ps-shim",
      type: "back",
      phase: "end",
      p: sideProgress(g.x - g.startX),
      vx: sampleVelocity(g.hist),
      commit: !!commit,
      hasBack: depth > 1,
    });
  }

  function onDown(e) {
    if (mode !== "mobile" || gesture) return;
    if (e.button !== 0 || (e.pointerType && e.pointerType !== "mouse")) return;
    if (e.clientX > EDGE || e.clientY < EDGE_SAFE || e.clientY > window.innerHeight - EDGE_SAFE) return;
    gesture = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      locked: false,
      hist: [{ x: e.clientX, t: performance.now() }],
    };
  }

  function onMove(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    var dx = e.clientX - gesture.startX;
    var dy = e.clientY - gesture.startY;
    if (!gesture.locked) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        gesture = null; // 纵向意图:让位给页面滚动
        return;
      }
      if (dx < START_DELTA) return;
      gesture.locked = true;
      gesture.x = e.clientX;
      try {
        document.documentElement.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 捕获失败不影响跟踪 */
      }
      document.body.style.userSelect = "none"; // 手势期间不让拖动变成选字
      if (touchTarget) {
        // 系统手势接管:与真机一致,向页面补发 touchcancel
        dispatch(e, "touchcancel", touchTarget);
        touchTarget = null;
      }
      post({ source: "ps-shim", type: "back", phase: "start", hasBack: depth > 1 });
    }
    gesture.x = e.clientX;
    gesture.hist.push({ x: e.clientX, t: performance.now() });
    if (gesture.hist.length > 6) gesture.hist.shift();
    post({ source: "ps-shim", type: "back", phase: "move", p: sideProgress(dx), hasBack: depth > 1 });
  }

  function onUp(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    var g = gesture;
    var commit =
      g.locked &&
      depth > 1 &&
      (g.x - g.startX > window.innerWidth * COMMIT_RATIO ||
        (g.x - g.startX > START_DELTA && sampleVelocity(g.hist) > FLING_VX));
    try {
      document.documentElement.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* 未捕获时忽略 */
    }
    endGesture(commit);
  }

  /* ---------- 触摸平移:按住拖动即滚动页面(真机上手指拖动就是滚动,而非选字/拖元素) ---------- */

  var pan = null;        // 进行中的平移
  var flingRaf = 0;      // 惯性滚动的动画帧
  var flingChain = null; // 惯性沿用的滚动链
  var flingVX = 0;
  var flingVY = 0;
  var panDragGuard = null; // 平移期间拦下原生拖拽(链接/图片/选字)

  function stopFling() {
    if (flingRaf) {
      cancelAnimationFrame(flingRaf);
      flingRaf = 0;
    }
  }

  // 指针落点处的滚动容器链:由内到外,平移的剩余量逐层外推(滚动链)
  function scrollChainUnder(target) {
    var chain = [];
    var n = target;
    while (n && n !== document.documentElement && n !== document.body) {
      if (n.nodeType === 1) {
        var cs = getComputedStyle(n);
        if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (n.scrollHeight > n.clientHeight || n.scrollWidth > n.clientWidth)) {
          chain.push(n);
        }
      }
      n = n.parentElement;
    }
    chain.push(document.scrollingElement || document.documentElement);
    return chain;
  }

  // 把位移施加到滚动容器,返回到达边界后的剩余量(内容跟手 1:1:手指向右内容向右)
  function applyPan(el, dx, dy) {
    var bx = el.scrollLeft;
    var by = el.scrollTop;
    el.scrollLeft = bx - dx;
    el.scrollTop = by - dy;
    return { x: dx - (bx - el.scrollLeft), y: dy - (by - el.scrollTop) };
  }

  function suppressPanClick(e) {
    e.stopPropagation();
    e.preventDefault();
    document.removeEventListener("click", suppressPanClick, true);
  }

  function endPan(e) {
    var p = pan;
    pan = null;
    if (!p || !p.locked) return;
    document.body.style.userSelect = "";
    document.removeEventListener("click", suppressPanClick, true);
    document.addEventListener("click", suppressPanClick, true); // 拖拽松手不触发链接
    try {
      document.documentElement.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* 未捕获时忽略 */
    }
    var v = sampleVec(p.hist);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && (Math.abs(v.x) > 120 || Math.abs(v.y) > 120)) {
      // 惯性:按松手速度衰减滚动,下一次按下即打断
      flingChain = p.chain;
      flingVX = v.x;
      flingVY = v.y;
      var last = performance.now();
      var step = function (now) {
        var dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        var k = Math.exp(-dt * 4.2); // 指数衰减,模拟触屏滚动阻力
        flingVX *= k;
        flingVY *= k;
        var left = { x: flingVX * dt, y: flingVY * dt };
        for (var i = 0; i < flingChain.length && (Math.abs(left.x) > 0.1 || Math.abs(left.y) > 0.1); i++) {
          left = applyPan(flingChain[i], left.x, left.y);
        }
        if (Math.abs(flingVX) < 24 && Math.abs(flingVY) < 24) {
          flingRaf = 0;
          return;
        }
        flingRaf = requestAnimationFrame(step);
      };
      flingRaf = requestAnimationFrame(step);
    }
  }

  function onPanDown(e) {
    if (mode !== "mobile" || pan) return;
    if (gesture && gesture.locked) return; // 返回手势接管期间不平移
    if (e.button !== 0 || (e.pointerType && e.pointerType !== "mouse")) return;
    // 左缘让给返回手势(与真机的手势排除区一致)
    if (e.clientX <= EDGE && e.clientY > EDGE_SAFE && e.clientY < window.innerHeight - EDGE_SAFE) return;
    stopFling();
    pan = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      locked: false,
      chain: scrollChainUnder(e.target),
      hist: [{ x: e.clientX, y: e.clientY, t: performance.now() }],
    };
  }

  function onPanMove(e) {
    if (!pan || e.pointerId !== pan.id) return;
    var dxTotal = e.clientX - pan.startX;
    var dyTotal = e.clientY - pan.startY;
    if (!pan.locked) {
      if (Math.abs(dxTotal) < 8 && Math.abs(dyTotal) < 8) return;
      pan.locked = true;
      try {
        document.documentElement.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 捕获失败不影响跟踪 */
      }
      document.body.style.userSelect = "none";
      panDragGuard = function (ev) {
        ev.preventDefault();
      };
      document.addEventListener("dragstart", panDragGuard, true);
    }
    var dx = e.clientX - pan.lastX;
    var dy = e.clientY - pan.lastY;
    pan.lastX = e.clientX;
    pan.lastY = e.clientY;
    pan.hist.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (pan.hist.length > 6) pan.hist.shift();
    var left = { x: dx, y: dy };
    for (var i = 0; i < pan.chain.length && (left.x || left.y); i++) {
      left = applyPan(pan.chain[i], left.x, left.y);
    }
  }

  function onPanUp(e) {
    if (!pan || e.pointerId !== pan.id) return;
    endPan(e);
  }

  // 二维速度采样(px/s),与侧滑手势共用同一形态
  function sampleVec(hist) {
    if (hist.length < 2) return { x: 0, y: 0 };
    var first = hist[0];
    var last = hist[hist.length - 1];
    var dt = last.t - first.t;
    if (dt <= 0) return { x: 0, y: 0 };
    return { x: ((last.x - first.x) / dt) * 1000, y: ((last.y - first.y) / dt) * 1000 };
  }

  /* ---------- 刷新动画抑制:壳层开启「刷新时禁用动画」后,刷新不再重播进场/加载动画 ---------- */

  // 偏好经壳层 anim 消息写入 sessionStorage:刷新后的新文档在解析早期(首帧绘制前)
  // 即可读到标记,赶在 CSS 动画首帧前停用;正常导航(点击链接/后退前进)与发布后的
  // 站点不含标记,行为不变。
  function suppressReloadAnim() {
    var marked = false;
    try {
      marked = sessionStorage.getItem("psNoReloadAnim") === "1";
    } catch (e) {
      /* 忽略 */
    }
    if (!marked || navType() !== "reload") return;
    var style = document.createElement("style");
    style.id = "ps-noanim";
    // 只停 animation(进场动画与加载转圈)并隐藏加载覆盖层,保留 transition(悬停反馈),
    // 刷新后的页面交互不受影响
    style.textContent =
      ".ps-noanim, .ps-noanim *, .ps-noanim *::before, .ps-noanim *::after { animation: none !important; }" +
      ".ps-loader { display: none !important; }";
    document.documentElement.classList.add("ps-noanim");
    (document.head || document.documentElement).appendChild(style);
  }

  /* ---------- 壳层消息:模式切换与历史导航 ---------- */

  // 移动模式的触点光标:圆形指尖样式替代系统箭头,模拟触摸屏幕。
  // 光标由 iframe 内部文档决定,只能由本脚本注入;深浅底色都可见。
  var TOUCH_CURSOR_SVG =
    "<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'>" +
    "<circle cx='14' cy='14' r='10' fill='rgba(110,110,120,0.16)' stroke='rgba(24,24,27,0.4)' stroke-width='2.6'/>" +
    "<circle cx='14' cy='14' r='10' fill='none' stroke='rgba(255,255,255,0.95)' stroke-width='1.4'/>" +
    "<circle cx='14' cy='14' r='2' fill='rgba(255,255,255,0.96)' stroke='rgba(24,24,27,0.4)' stroke-width='0.8'/>" +
    "</svg>";

  function applyTouchCursor(on) {
    document.documentElement.classList.toggle("ps-touch-cursor", !!on);
    if (!on || document.getElementById("ps-touch-cursor-style")) return;
    var style = document.createElement("style");
    style.id = "ps-touch-cursor-style";
    // 移动模式:触点光标 + 隐藏滚动条(真机浏览器无持续可见滚动条)
    style.textContent =
      ".ps-touch-cursor, .ps-touch-cursor * { cursor: url(\"data:image/svg+xml," +
      encodeURIComponent(TOUCH_CURSOR_SVG) +
      "\") 14 14, pointer !important; scrollbar-width: none !important; }" +
      ".ps-touch-cursor::-webkit-scrollbar, .ps-touch-cursor *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }";
    document.head.appendChild(style);
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.source !== "ps-shell") return;
    if (d.type === "mode") {
      if (mode === d.mode) return;
      mode = d.mode;
      applyTouchCursor(mode === "mobile");
      if (mode !== "mobile") {
        stopFling();
        pan = null;
      }
      if (mode !== "mobile" && gesture) endGesture(false); // 切模式打断进行中的手势
    } else if (d.type === "anim") {
      // 刷新动画偏好:写入会话标记,刷新后的新文档据此在首帧前停用进场动画
      try {
        if (d.disabled) sessionStorage.setItem("psNoReloadAnim", "1");
        else sessionStorage.removeItem("psNoReloadAnim");
      } catch (err) {
        /* 会话存储不可用时按未标记处理 */
      }
    } else if (d.type === "history" && typeof d.delta === "number") {
      history.go(d.delta); // delta 0 = 刷新当前页
    }
  });

  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerup", onUp, true);
  document.addEventListener("pointercancel", onUp, true);
  document.addEventListener("pointerdown", onPanDown, true);
  document.addEventListener("pointermove", onPanMove, true);
  document.addEventListener("pointerup", onPanUp, true);
  document.addEventListener("pointercancel", onPanUp, true);
  document.addEventListener("pointerdown", mirror, true);
  document.addEventListener("pointermove", mirror, true);
  document.addEventListener("pointerup", mirror, true);
  document.addEventListener("pointercancel", mirror, true);
  window.addEventListener("blur", function () {
    if (gesture) endGesture(false); // 失焦打断手势,视作取消
    if (pan) {
      pan = null; // 失焦打断平移
      document.body.style.userSelect = "";
      document.removeEventListener("click", suppressPanClick, true);
    }
    stopFling();
  });

  reportPage();
  suppressReloadAnim(); // 尽早执行:赶在首帧绘制前停用刷新场景的进场/加载动画
  window.addEventListener("pageshow", reportPage); // 含 bfcache 恢复的后退/前进
  window.addEventListener("popstate", reportPage);
  window.addEventListener("hashchange", reportPage);
})();
