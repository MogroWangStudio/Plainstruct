/** 界面缩放换算 —— 历史遗留兼容层:「界面字号」曾以 html 的 CSS zoom 整页
 *  缩放实现(浮层定位需在此换算),现改为只缩放文字(--ui-font-scale),
 *  无 zoom,本模块恒返回 1;保留函数以兼容既有调用点 */

/** 当前界面缩放倍率(恒为 1) */
export function uiZoom(): number {
  const z = parseFloat(getComputedStyle(document.documentElement).zoom || "1");
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/** 视觉像素 -> 浮层定位用的 CSS 像素(声明值经 zoom 放大后回到视觉值) */
export function toCssPx(visualPx: number): number {
  return visualPx / uiZoom();
}
