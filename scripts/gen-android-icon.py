"""重生成安卓启动图标(自适应前景 + 旧式方形/圆形)。

桌面图标即同一字形的品牌标识;安卓此前由 tauri icon 生成的前景层是
「不透明白底整幅字形」,自适应图标经圆形遮罩裁切后字形过大且出血。
本脚本按矢量坐标重绘字形:透明前景、字形缩放到遮罩安全区内并精确居中,
旧式方形/圆形图标铺白底 + 同比例居中字形,与桌面端品牌标识一致。

用法:python scripts/gen-android-icon.py
依赖:Pillow(pip install pillow);输出同时写入 icons/android 与
gen/android/app/src/main/res(出包实际引用的资源)。
"""
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

INK = (17, 15, 14, 255)        # 墨色(与界面 --color-ink 同源的暖黑)
SLASH_ALPHA = round(255 * 0.15)  # 斜杠 15% 墨色,铺在白底上即浅灰
WHITE = (255, 255, 255, 255)

# 字形宽度占画布比例:自适应图标安全区为中央 66/108,62% 留出呼吸边
GLYPH_RATIO = 0.62
# 旧式方形/圆形图标:白底铺满画布,字形同比例居中
LAUNCHER_DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND_DENSITIES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
SS = 4  # 超采样倍率:先放大绘制再缩小,得到抗锯齿边缘


def draw_glyph(draw: ImageDraw.ImageDraw, k: float, ox: float, oy: float) -> None:
    """按缩放系数 k 与偏移(ox, oy)绘制字形;绘制顺序与 SVG 一致(眼睛盖住斜杠重叠区)。"""
    def pt(p):
        return ((p[0] * k + ox), (p[1] * k + oy))

    def rect(r):
        return [r[0] * k + ox, r[1] * k + oy, (r[0] + r[2]) * k + ox, (r[1] + r[3]) * k + oy]

    draw.rectangle(rect(MOUTH), fill=INK)
    draw.polygon([pt(p) for p in BRACKET], fill=INK)
    draw.polygon([pt(p) for p in SLASH], fill=(17, 15, 14, SLASH_ALPHA))
    for eye in EYES:
        draw.rectangle(rect(eye), fill=INK)


def render(size: int, background: str) -> Image.Image:
    """渲染 size x size 图标;background = "transparent" | "square" | "circle"。"""
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if background == "square":
        draw.rectangle([0, 0, big - 1, big - 1], fill=WHITE)
    elif background == "circle":
        draw.ellipse([0, 0, big - 1, big - 1], fill=WHITE)
    k = GLYPH_RATIO * big / GLYPH_W
    ox = (big - GLYPH_W * k) / 2
    oy = (big - GLYPH_H * k) / 2
    draw_glyph(draw, k, ox, oy)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    outputs = []
    for density, size in LAUNCHER_DENSITIES.items():
        outputs.append((ICONS / f"mipmap-{density}", "ic_launcher.png", render(size, "square")))
        outputs.append((ICONS / f"mipmap-{density}", "ic_launcher_round.png", render(size, "circle")))
    for density, size in FOREGROUND_DENSITIES.items():
        outputs.append((ICONS / f"mipmap-{density}", "ic_launcher_foreground.png", render(size, "transparent")))
    for dir_path, name, img in outputs:
        dir_path.mkdir(parents=True, exist_ok=True)
        img.save(dir_path / name)
        gen_dir = GEN_RES / dir_path.name
        gen_dir.mkdir(parents=True, exist_ok=True)
        img.save(gen_dir / name)
        print(f"{dir_path.name}/{name}  {img.size[0]}x{img.size[1]}")


if __name__ == "__main__":
    main()
