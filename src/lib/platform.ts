/** 平台与布局判定:移动端(安卓/iOS)使用独立的 Shell 与导航结构 */
import { computed } from "vue";
import { useAppStore } from "@/stores/app";

/** 触屏移动平台(区别于桌面):整个应用走移动布局,不随窗口宽度切换 */
export const isMobilePlatform = computed(() => {
  const platform = useAppStore().platform;
  return platform === "android" || platform === "ios";
});

/** 平台显示名(同步页设备平台徽标等) */
export function platformLabel(platform: string): string {
  switch (platform) {
    case "android":
      return "Android";
    case "ios":
      return "iOS";
    case "windows":
      return "Windows";
    case "macos":
      return "macOS";
    default:
      return platform || "未知";
  }
}
