#!/usr/bin/env python3
"""
Generate Chirp app icon assets from the bird emoji 🐦.

Renders Apple Color Emoji at a fixed size onto each target canvas:
  - assets/icon.png            1024x1024  dark canvas, large bird
  - assets/adaptive-icon.png   1024x1024  transparent, bird in 50% safe zone
  - assets/splash.png          1242x2436  splash backdrop, bird centered
  - assets/favicon.png         64x64      dark, large bird

Run:  python3 scripts/generate-icons.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

EMOJI = "\U0001F426"
FONT_PATH = "/System/Library/Fonts/Apple Color Emoji.ttc"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "assets"))
DARK_BG = (8, 8, 11, 255)
SPLASH_BG = (10, 13, 17, 255)

# Apple Color Emoji is a bitmap font — Pillow can only load it at one of the
# 5 strikes (20, 32, 40, 48, 64, 96, 160). 137 fails. We render the largest
# strike (160) and then resize.
EMOJI_STRIKE = 137


def render_emoji_canvas(size: int, scale: float) -> Image.Image:
    """Return an RGBA image of `size`×`size` with the emoji centered, fitted to `scale`."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    src = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
    draw = ImageDraw.Draw(src)
    font = ImageFont.truetype(FONT_PATH, EMOJI_STRIKE)
    draw.text((0, 0), EMOJI, font=font, embedded_color=True)
    target = int(size * scale)
    resized = src.resize((target, target), Image.LANCZOS)
    pos = ((size - target) // 2, (size - target) // 2)
    canvas.paste(resized, pos, resized)
    return canvas


def composite_on_bg(size: int, scale: float, bg: tuple) -> Image.Image:
    base = Image.new("RGBA", (size, size), bg)
    bird = render_emoji_canvas(size, scale)
    return Image.alpha_composite(base, bird)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

    composite_on_bg(1024, 0.62, DARK_BG).save(os.path.join(OUT_DIR, "icon.png"))
    render_emoji_canvas(1024, 0.50).save(os.path.join(OUT_DIR, "adaptive-icon.png"))

    splash = Image.new("RGBA", (1242, 2436), SPLASH_BG)
    bird = render_emoji_canvas(1242, 0.34)
    y_offset = (2436 - 1242) // 2
    bird_full = Image.new("RGBA", (1242, 2436), (0, 0, 0, 0))
    bird_full.paste(bird, (0, y_offset), bird)
    splash = Image.alpha_composite(splash, bird_full)
    splash.save(os.path.join(OUT_DIR, "splash.png"))

    composite_on_bg(64, 0.78, DARK_BG).save(os.path.join(OUT_DIR, "favicon.png"))

    print("Wrote 4 icon assets to", OUT_DIR)


if __name__ == "__main__":
    main()
