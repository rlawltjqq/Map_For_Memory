# -*- coding: utf-8 -*-
"""PWA 아이콘 생성 → icons/icon-{size}.png, icons/maskable-{size}.png

지도 위 초록 핀 모양. 외부 이미지 없이 PIL로 직접 그린다.
"""
import os

from PIL import Image, ImageDraw

OUT = "icons"
os.makedirs(OUT, exist_ok=True)

BG = (59, 156, 110)        # 브랜드 초록
BG_SOFT = (233, 246, 239)  # 연한 민트
PIN = (255, 255, 255)
LAND = (183, 228, 199)     # 파스텔 민트 (지도 채움)


def draw_icon(size, maskable=False):
    S = size * 4  # 4배로 그린 뒤 축소 (안티앨리어싱)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 배경: 라운드 사각(일반) / 꽉 찬 사각(maskable — OS가 알아서 깎음)
    if maskable:
        d.rectangle([0, 0, S, S], fill=BG)
        pad = int(S * 0.20)          # 안전영역 20%
    else:
        d.rounded_rectangle([0, 0, S, S], radius=int(S * 0.22), fill=BG)
        pad = int(S * 0.16)

    inner = S - pad * 2

    # 지도(둥근 사각) 위에 핀
    map_w, map_h = inner, int(inner * 0.78)
    mx, my = pad, pad + (inner - map_h) // 2
    d.rounded_rectangle([mx, my, mx + map_w, my + map_h],
                        radius=int(map_w * 0.12), fill=BG_SOFT)

    # 지도 안 대륙 느낌 얼룩 두 개
    d.ellipse([mx + map_w * 0.10, my + map_h * 0.16,
               mx + map_w * 0.52, my + map_h * 0.62], fill=LAND)
    d.ellipse([mx + map_w * 0.55, my + map_h * 0.45,
               mx + map_w * 0.92, my + map_h * 0.88], fill=LAND)

    # 핀 (물방울 + 구멍)
    cx = mx + map_w * 0.5
    top = my + map_h * 0.12
    r = map_w * 0.20
    cy = top + r
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=PIN)
    tip_y = my + map_h * 0.88
    d.polygon([(cx - r * 0.72, cy + r * 0.62), (cx + r * 0.72, cy + r * 0.62), (cx, tip_y)],
              fill=PIN)
    hr = r * 0.42
    d.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=BG)

    return img.resize((size, size), Image.LANCZOS)


for size in (192, 512):
    draw_icon(size).save(f"{OUT}/icon-{size}.png")
    draw_icon(size, maskable=True).save(f"{OUT}/maskable-{size}.png")
draw_icon(180).save(f"{OUT}/apple-touch-icon.png")   # iOS 홈 화면
draw_icon(32).save(f"{OUT}/favicon-32.png")
print("아이콘 생성 완료:", sorted(os.listdir(OUT)))
