/** 启动诊断与自愈层。
 *  致命启动失败(产物资源加载失败/脚本错误/长时间未挂载)时向上报连续失败计数,
 *  按返回动作分级自愈:第一次重载,第二次清理 WebView 浏览数据后重载(白屏的
 *  经典根因即浏览数据损坏),仍失败才显示错误遮罩交人工处理。
 *  应用挂载成功后本层完全沉默;CSP script-src 'self' 允许此外链脚本。 */
(function () {
  "use strict";

  var inTauri = "__TAURI_INTERNALS__" in window;
  var mounted = false; // 应用挂载成功:之后的错误属应用运行期,不再接管
  var recovering = false; // 自愈进行中:同一轮只上报一次,防多个错误重复触发

  function show(title, detail) {
    if (mounted) return;
    var box = document.getElementById("__boot_error__");
    if (!box) {
      box = document.createElement("div");
      box.id = "__boot_error__";
      box.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:#fffdf8;color:#8c2f1b;" +
        "padding:20px;overflow:auto;font:13px/1.7 ui-monospace,Consolas,monospace;" +
        "white-space:pre-wrap;border-top:4px solid #8c2f1b";
      (document.body || document.documentElement).appendChild(box);
    }
    box.textContent += (box.textContent ? "\n\n" : "") + "[" + title + "]\n" + detail;
  }

  function invoke(cmd, args) {
    try {
      return window.__TAURI_INTERNALS__.invoke(cmd, args);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /** 致命启动失败:上报计数并按动作自愈 */
  function fatal(stage, detail) {
    show(stage, detail);
    if (!inTauri || mounted || recovering) return;
    recovering = true;
    invoke("report_boot_failure", {
      stage: stage,
      detail: String(detail).slice(0, 2000),
    })
      .then(function (action) {
        if (action === "reload" || action === "clear-data") {
          // clear-data 时 Rust 端已清理完毕,直接重载即得干净环境
          window.location.reload();
        } else {
          show("自动修复失败", "已自动尝试重载与清理浏览器缓存仍未恢复。\n" + "请截图上方错误信息反馈。");
        }
      })
      .catch(function () {
        /* 上报通道不可用:保持遮罩展示原始错误 */
      });
  }

  // 脚本错误与资源加载失败(capture 阶段才能拿到资源错误的 target)
  window.addEventListener(
    "error",
    function (e) {
      if (e.target && e.target !== window && (e.target.src || e.target.href)) {
        var url = String(e.target.src || e.target.href).split("?")[0];
        // 仅应用自身产物(j/css)加载失败判为致命;图片等缺失只展示不接管
        if (/\.(m?js|css|ts)$/.test(url)) {
          fatal("产物资源加载失败", url);
        } else {
          show("资源加载失败", url);
        }
        return;
      }
      fatal("脚本错误", (e.message || "unknown") + "\n" + ((e.error && e.error.stack) || "(no stack)"));
    },
    true,
  );

  // 未处理的 Promise 拒绝:仅展示。挂载前它多来自后台初始化,不足以证明启动失败;
  // 真正的模块加载失败会同时触发脚本错误/资源错误,由那里接管
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    show("未处理的 Promise 拒绝", (r && (r.stack || r.message)) || String(r));
  });

  // 应用挂载成功:移除遮罩并沉默(此后不再新建遮罩、不再自愈)
  var observer = new MutationObserver(function () {
    var app = document.getElementById("app");
    if (app && app.childElementCount) {
      mounted = true;
      observer.disconnect();
      var box = document.getElementById("__boot_error__");
      if (box) box.remove();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // 挂载超时兜底:15s 仍无内容则按致命失败上报
  window.setTimeout(function () {
    var app = document.getElementById("app");
    if (app && !app.childElementCount) {
      fatal(
        "启动超时",
        "应用 15 秒内未完成挂载。常见原因:\n" +
          "1. WebView2 运行时版本过旧或安装异常(到「设置 > 应用」检查 Microsoft Edge WebView2)\n" +
          "2. 脚本/资源加载被安全策略拦截\n" +
          "上方如有其他错误信息,请一并截图反馈。",
      );
    }
  }, 15000);
})();
