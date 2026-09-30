/** 界面缩放换算 —— 个性化「界面字号」经 html 的 CSS zoom 实现,放大后:
 *  getBoundingClientRect 与指针坐标返回视觉像素(已含 zoom),而
 *  window.innerWidth/innerHeight 不含 zoom,fixed/absolute 定位的 CSS px
 *  又会被 zoom 放大 —— 浮层定位需经此处换算,保证任意档位下位置正确 */

/** 当前界面缩放倍率(未开启缩放时为 1) */
export function uiZoom(): number {
  const z = parseFloat(getComputedStyle(document.documentElement).zoom || "1");
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/** 视觉像素 -> 浮层定位用的 CSS 像素(声明值经 zoom 放大后回到视觉值) */
export function toCssPx(visualPx: number): number {
  return visualPx / uiZoom();
}
