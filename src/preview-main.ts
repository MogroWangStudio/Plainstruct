/** 独立预览窗口壳层入口:不初始化应用 store(bootstrap 命令仅主窗口可用),
 *  外观与语言由创建窗口时携带的参数恢复;窗口由壳层就绪后自显,
 *  避免无装饰窗口在内容就绪前的白屏闪烁。 */
import { createApp } from "vue";
import PreviewShell from "@/views/PreviewShell.vue";
import { i18n } from "@/i18n";
import "./assets/main.css";

const params = new URLSearchParams(location.search);

i18n.global.locale.value = params.get("locale") === "en-US" ? "en-US" : "zh-CN";

const theme = params.get("theme");
if (theme) document.documentElement.dataset.theme = theme;
const fontScale = Number(params.get("fontScale"));
if (Number.isFinite(fontScale) && fontScale > 0) {
  document.documentElement.style.setProperty("--ui-font-scale", String(fontScale));
}
const fontWeight = Number(params.get("fontWeight"));
if (Number.isFinite(fontWeight) && fontWeight > 0) {
  document.documentElement.style.setProperty("--font-weight-ui", String(fontWeight));
}
const title = params.get("title");
if (title) document.title = title;

createApp(PreviewShell).use(i18n).mount("#app");
