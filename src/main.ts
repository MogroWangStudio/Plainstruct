import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { i18n } from "./i18n";
import { ipc } from "./ipc/ipc";
import "./assets/main.css";

createApp(App).use(createPinia()).use(i18n).mount("#app");

// 阻止浏览器环境下的系统级文件拖放导航
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

// 启动诊断层在挂载成功后会沉默,这里兜住挂载后的异步失败并写入 Rust 日志
window.addEventListener("unhandledrejection", (e) => {
  void ipc.logFrontend(`[boot] unhandled rejection: ${ipc.errText(e.reason)}`);
});
