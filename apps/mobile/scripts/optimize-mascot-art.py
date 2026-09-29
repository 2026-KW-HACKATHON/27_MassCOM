#!/usr/bin/env python3
"""Codex 원본을 앱용 크기로 줄인다. 포즈는 긴 변 512px·팔레트 PNG(알파 유지), 배경은 1080px."""
import sys
from pathlib import Path
from PIL import Image

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'assets/images/mascot/v2')
poses = ['wave', 'explore-map', 'stamp', 'gift', 'sleep', 'puzzled', 'friends', 'search', 'cheer', 'logo-badge']
for name in poses:
    path = root / f'{name}.png'
    image = Image.open(path).convert('RGBA')
    image.thumbnail((512, 512), Image.LANCZOS)
    image.quantize(colors=128, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(path, optimize=True)
for name, width in [('sky-town-header', 1080), ('town-map', 1080)]:
    path = root / f'{name}.png'
    image = Image.open(path).convert('RGB')
    image.thumbnail((width, width * 2), Image.LANCZOS)
    image.quantize(colors=192, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)
for path in sorted(root.glob('*.png')):
    print(f'{path.name}\t{Image.open(path).size}\t{path.stat().st_size // 1024}KB')
