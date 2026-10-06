/** 纸屑庆祝特效 -- 发布成功等完成时刻的短暂致意。
 *  无依赖:按需创建一块固定定位的透明 canvas 覆盖窗口,
 *  requestAnimationFrame 驱动重力 + 空气阻力 + 旋转的纸片运动,
 *  约 2.2 秒自然落尽后自动移除画布;遵循系统「减弱动态效果」设置。
 *  程度三档(设置页「个性化」可选,默认标准):轻为双角束,
 *  标准与夸张在两角之外加中央上抛束,粒数/初速/纸片逐档加大。 */

import type { ConfettiLevel } from "@/ipc/types";

/** 纸屑配色:取自应用六套配色的低饱和强调色,纸屑般克制 */
const PALETTE = ["#d9a441", "#c97b5d", "#6fae8f", "#7a9cc6", "#8a837d", "#e3d9c4"];

/** 同屏只保留一场动画,重复触发直接忽略 */
let active = false;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 矩形纸片的两边长(各自独立,翻转时有透视感) */
  w: number;
  h: number;
  /** 空间朝向:影响可见高度(纸片侧对时收窄) */
  tilt: number;
  tiltSpeed: number;
  rotation: number;
  rotationSpeed: number;
  color: string;
  born: number;
  life: number;
}

/** 各档抛洒参数:开场束 + 可选的持续喷射流(流按间隔重复出束) */
interface LevelSpec {
  bursts: { x: number; y: number; dir: number; count: number }[];
  /** 持续喷射流:{x, y, dir, count, every, until} —— every 毫秒一束,until 毫秒后停 */
  streams?: { x: number; y: number; dir: number; count: number; every: number; until: number }[];
  speedBase: number;
  speedVar: number;
  lifeBase: number;
  lifeVar: number;
  size: number;
}
const LEVELS: Record<Exclude<ConfettiLevel, "off">, LevelSpec> = {
  light: {
    bursts: [
      { x: 0.12, y: 0.72, dir: 1, count: 20 },
      { x: 0.88, y: 0.72, dir: -1, count: 20 },
    ],
    speedBase: 8,
    speedVar: 5,
    lifeBase: 1400,
    lifeVar: 600,
    size: 1,
  },
  standard: {
    bursts: [
      { x: 0.12, y: 0.72, dir: 1, count: 46 },
      { x: 0.88, y: 0.72, dir: -1, count: 46 },
      { x: 0.5, y: 0.8, dir: 0, count: 26 },
    ],
    speedBase: 10,
    speedVar: 7,
    lifeBase: 1600,
    lifeVar: 800,
    size: 1,
  },
  grand: {
    // 夸张档:开场两角斜上 + 之后底部左右与顶部持续对喷,双倍夸张
    bursts: [
      { x: 0.1, y: 0.72, dir: 1, count: 74 },
      { x: 0.9, y: 0.72, dir: -1, count: 74 },
      { x: 0.5, y: 0.82, dir: 0, count: 46 },
    ],
    streams: [
      { x: 0.08, y: 1.04, dir: 1, count: 14, every: 220, until: 1500 },
      { x: 0.92, y: 1.04, dir: -1, count: 14, every: 220, until: 1500 },
      { x: 0.2, y: -0.04, dir: 1, count: 10, every: 260, until: 1300 },
      { x: 0.8, y: -0.04, dir: -1, count: 10, every: 260, until: 1300 },
    ],
    speedBase: 12,
    speedVar: 9,
    lifeBase: 1900,
    lifeVar: 900,
    size: 1.18,
  },
};

/** 在视口坐标 (ox, oy) 处向 (dirX 方向) 斜上抛出一束纸屑;dirX 为 0 时直上略散 */
function burst(
  px: Particle[],
  ox: number,
  oy: number,
  dirX: number,
  count: number,
  now: number,
  L: (typeof LEVELS)[Exclude<ConfettiLevel, "off">],
) {
  for (let i = 0; i < count; i++) {
    // 仰角 55°–80°,朝向画面中央,带随机散布
    const elevation = (55 + Math.random() * 25) * (Math.PI / 180);
    const speed = L.speedBase + Math.random() * L.speedVar;
    const spread = (Math.random() - 0.5) * 0.35;
    const life = L.lifeBase + Math.random() * L.lifeVar;
    px.push({
      x: ox + (Math.random() - 0.5) * 24,
      y: oy + (Math.random() - 0.5) * 24,
      vx: Math.cos(elevation) * speed * (dirX + spread),
      vy: -Math.sin(elevation) * speed,
      w: (5 + Math.random() * 4) * L.size,
      h: (8 + Math.random() * 6) * L.size,
      tilt: Math.random() * Math.PI,
      tiltSpeed: 0.08 + Math.random() * 0.18,
      rotation: Math.random() * Math.PI,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      born: now,
      life,
    });
  }
}

export function confettiEnabled(): boolean {
  return typeof matchMedia === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 按设置档位抛洒纸屑(默认标准档):左右两角向中央斜上,标准/夸张档另有中央上抛束 */
export function fireConfetti(level: ConfettiLevel = "standard"): void {
  if (level === "off" || active || !confettiEnabled()) return;
  const L = LEVELS[level];
  active = true;

  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    active = false;
    return;
  }
  ctx.scale(dpr, dpr);

  const particles: Particle[] = [];
  const start = performance.now();
  for (const b of L.bursts) {
    burst(particles, w * b.x, h * b.y, b.dir, b.count, start, L);
  }
  // 持续喷射流的下一次出束时刻(夸张档:上下对喷)
  const streamNext = (L.streams ?? []).map(() => start + 260);

  let prev = start;
  function frame(now: number) {
    // 60fps 基准的时间归一,掉帧时运动不加速
    const dt = Math.min((now - prev) / (1000 / 60), 3);
    prev = now;
    ctx!.clearRect(0, 0, w, h);

    // 喷射流:到点就从屏外上/下缘再抛一束,直到各自截止
    (L.streams ?? []).forEach((st, i) => {
      if (now - start <= st.until && now >= streamNext[i]) {
        streamNext[i] = now + st.every;
        burst(particles, w * st.x, h * st.y, st.dir, st.count, now, L);
      }
    });

    let alive = false;
    for (const p of particles) {
      const age = now - p.born;
      if (age > p.life) continue;
      alive = true;

      // 空气阻力 + 重力
      p.vx *= Math.pow(0.985, dt);
      p.vy = p.vy * Math.pow(0.985, dt) + 0.32 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.rotationSpeed * dt;
      p.tilt += p.tiltSpeed * dt;

      // 落幕前 300ms 渐隐
      const fade = Math.min(1, (p.life - age) / 300);
      ctx!.globalAlpha = fade;

      // 侧倾投影出可见宽度,纸片侧对时收成细线
      const visibleH = Math.abs(Math.sin(p.tilt)) * p.h + 0.8;
      ctx!.save();
      ctx!.translate(p.x, p.y);
      ctx!.rotate(p.rotation);
      ctx!.fillStyle = p.color;
      ctx!.fillRect((-p.w / 2) * (0.55 + 0.45 * Math.abs(Math.cos(p.tilt))), -visibleH / 2, p.w * (0.55 + 0.45 * Math.abs(Math.cos(p.tilt))), visibleH);
      ctx!.restore();
    }
    ctx!.globalAlpha = 1;

    if (alive) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
      active = false;
    }
  }
  requestAnimationFrame(frame);
}
