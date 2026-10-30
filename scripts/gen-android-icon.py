"""重生成安卓启动图标(自适应前景 + 旧式方形/圆形)。

桌面图标(src-tauri/icons/icon.svg)即同一字形的品牌标识:白底、字形宽高占画布 63%
并精确居中。安卓按同一比例出图,但自适应图标的前景层有两点几何差异必须补偿:

  1. 前景画布 108dp,系统只显示中央 72dp(遮罩圆/方圆/圆角矩形各不相同);
  2. 可视区直径 72dp,安全区为中央 66dp 圆 —— 字形必须落在安全区内,否则被裁。

因此前景层的字形比例 = 桌面比例 × 72/108 ≈ 0.42(相对整幅 108dp 画布),这样在
任意桌面遮罩下看到的字形大小与桌面图标一致,不会出血。旧式方形/圆形图标直接铺
白底 + 63% 字形,与桌面图标逐像素同构。

用法:python3 scripts/gen-android-icon.py [--preview 输出目录]
依赖:Pillow(pip install pillow);输出同时写入 icons/android 与
gen/android/app/src/main/res(出包实际引用的资源)。
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "src-tauri" / "icons" / "android"
GEN_RES = ROOT / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "res"

# 字形矢量坐标(与 BrandLogo.vue / public/logo.svg 展平坐标一致,viewBox 251x243)
GLYPH_W, GLYPH_H = 250.4, 242.14
MOUTH = (0.0, 173.13, 250.4, 69.01)  # rect x y w h
BRACKET = [
    (69.01, 173.13), (69.01, 242.14), (0.0, 242.14), (0.0, 21.7),
    (69.01, 21.7), (69.01, 90.71), (34.5, 90.71), (34.5, 173.13),
]
SLASH = [(104.06, 97.24), (201.31, 0.0), (235.98, 34.67), (138.74, 131.92)]
EYES = [(89.71, 0.0, 49.04, 131.92), (201.37, 0.0, 49.03, 131.92)]  # rect x y w h

INK = (17, 15, 14)             # 墨色(与界面 --color-ink 同源的暖黑)
SLASH_ALPHA = 0.15             # 斜杠 15% 墨色,铺在白底上即浅灰
WHITE = (255, 255, 255)

# 桌面图标:字形 bbox 占画布边长 642.56 / 1024 = 62.75%(见 icons/icon.svg 注释)
DESKTOP_RATIO = 642.56 / 1024
# 自适应图标:可见区 / 画布 = 72 / 108
VISIBLE_RATIO = 72 / 108
# 旧式图标铺满画布即用桌面比例;自适应前景需按可见区折算
LEGACY_RATIO = DESKTOP_RATIO
ADAPTIVE_RATIO = DESKTOP_RATIO * VISIBLE_RATIO

LAUNCHER_DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND_DENSITIES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
SS = 4  # 超采样倍率:先放大绘制再缩小,得到抗锯齿边缘


def draw_glyph(draw: ImageDraw.ImageDraw, k: float, ox: float, oy: float) -> None:
    """按缩放系数 k 与偏移(ox, oy)绘制字形;顺序与 SVG 一致(眼睛盖住斜杠重叠区)。"""
    def pt(p):
        return (p[0] * k + ox, p[1] * k + oy)

    def rect(r):
        return [r[0] * k + ox, r[1] * k + oy, (r[0] + r[2]) * k + ox, (r[1] + r[3]) * k + oy]

    slash = (*INK, round(255 * SLASH_ALPHA))
    draw.rectangle(rect(MOUTH), fill=(*INK, 255))
    draw.polygon([pt(p) for p in BRACKET], fill=(*INK, 255))
    draw.polygon([pt(p) for p in SLASH], fill=slash)
    for eye in EYES:
        draw.rectangle(rect(eye), fill=(*INK, 255))


def render(size: int, background: str, ratio: float) -> Image.Image:
    """渲染 size x size 图标;background = "transparent" | "square" | "circle"。

    字形 bbox 按 ratio 占画布边长比例缩放,并在两个方向上精确居中。
    """
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if background == "square":
        draw.rectangle([0, 0, big - 1, big - 1], fill=(*WHITE, 255))
    elif background == "circle":
        draw.ellipse([0, 0, big - 1, big - 1], fill=(*WHITE, 255))
    k = ratio * big / GLYPH_W
    ox = (big - GLYPH_W * k) / 2
    oy = (big - GLYPH_H * k) / 2
    draw_glyph(draw, k, ox, oy)
    return img.resize((size, size), Image.LANCZOS)


def write_previews(out: Path) -> None:
    """按各桌面遮罩合成预览:自适应图标(圆/方圆/圆角矩形)+ 旧式方形/圆形。"""
    out.mkdir(parents=True, exist_ok=True)
    n = 432
    fg = render(n, "transparent", ADAPTIVE_RATIO)
    base = Image.new("RGBA", (n, n), (*WHITE, 255))
    base.alpha_composite(fg)
    # 系统只显示中央 72/108,这里按同样的裁切模拟
    vis = round(n * VISIBLE_RATIO)
    off = (n - vis) // 2
    shown = base.crop((off, off, off + vis, off + vis)).resize((n, n), Image.LANCZOS)
    masks = {
        "adaptive_circle": lambda d, s: d.ellipse([0, 0, s - 1, s - 1], fill=255),
        "adaptive_squircle": lambda d, s: d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s // 4, fill=255),
        "adaptive_rounded": lambda d, s: d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s // 8, fill=255),
    }
    for name, fn in masks.items():
        m = Image.new("L", (n, n), 0)
        fn(ImageDraw.Draw(m), n)
        img = shown.copy()
        img.putalpha(m)
        img.save(out / f"{name}.png")
    render(n, "square", LEGACY_RATIO).save(out / "legacy_square.png")
    render(n, "circle", LEGACY_RATIO).save(out / "legacy_circle.png")


def main() -> None:
    outputs = []
    for density, size in LAUNCHER_DENSITIES.items():
        outputs.append((ICONS / f"mipmap-{density}", "ic_launcher.png", render(size, "square", LEGACY_RATIO)))
        outputs.append((ICONS / f"mipmap-{density}", "ic_launcher_round.png", render(size, "circle", LEGACY_RATIO)))
    for density, size in FOREGROUND_DENSITIES.items():
        outputs.append((ICONS / f"mipmap-{density}", "ic_launcher_foreground.png", render(size, "transparent", ADAPTIVE_RATIO)))
    for dir_path, name, img in outputs:
        dir_path.mkdir(parents=True, exist_ok=True)
        img.save(dir_path / name)
        gen_dir = GEN_RES / dir_path.name
        gen_dir.mkdir(parents=True, exist_ok=True)
        img.save(gen_dir / name)
        print(f"{dir_path.name}/{name}  {img.size[0]}x{img.size[1]}")

    if "--preview" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--preview") + 1])
        write_previews(out)
        print(f"previews -> {out}")


if __name__ == "__main__":
    main()
