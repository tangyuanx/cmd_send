"""Regenerate committed app icons: pip install CairoSVG==2.9.1 Pillow==12.3.0.

The SVG matches .brand-mark and iconPaths.terminal in the light theme.
Normal application builds use the committed assets and do not need Python.
"""
from io import BytesIO
from pathlib import Path

import cairosvg
from PIL import Image

root = Path(__file__).resolve().parent.parent
assets = root / "assets"
svg = (assets / "icon.svg").read_bytes()
image = Image.open(BytesIO(cairosvg.svg2png(bytestring=svg, output_width=1024, output_height=1024))).convert("RGBA")
image.save(assets / "icon.png")
image.save(assets / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)], bitmap_format="bmp")
image.save(assets / "icon.icns", sizes=[(s, s) for s in (16, 32, 64, 128, 256, 512, 1024)])
(root / "src" / "favicon.svg").write_bytes(svg)
print("Generated PNG, multi-size ICO, ICNS and favicon from assets/icon.svg")
