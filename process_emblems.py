# -*- coding: utf-8 -*-
"""emblems.json의 위키미디어 이미지를 받아 흰 배경 제거 + 심벌만 크롭 → emblems/{code}.png

깃발형 이미지(흰 직사각형 바탕 + 심벌)의 배경을 없애기 위해,
가장자리에서 연결된 흰색 영역만 플러드필로 투명 처리한다
(심벌 내부의 흰색은 보존). 그 후 알파 기준으로 크롭.
"""
import io
import json
import os
import time
import urllib.error
import urllib.request
from collections import deque

from PIL import Image

HEADERS = {"User-Agent": "MapForMemory/1.0 (personal hobby project)"}
OUT_DIR = "emblems"
THR = 235          # 이 값 이상(R,G,B 모두)이면 '흰색'으로 간주
MAX_SIDE = 96

os.makedirs(OUT_DIR, exist_ok=True)


def strip_white_bg(img):
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()

    def is_white(x, y):
        r, g, b, a = px[x, y]
        return a > 0 and r >= THR and g >= THR and b >= THR

    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_white(x, y) and not seen[y * w + x]:
                seen[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_white(x, y) and not seen[y * w + x]:
                seen[y * w + x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        r, g, b, a = px[x, y]
        px[x, y] = (r, g, b, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and is_white(nx, ny):
                seen[ny * w + nx] = 1
                q.append((nx, ny))
    return img


def process(data):
    img = Image.open(io.BytesIO(data))
    img = strip_white_bg(img)
    alpha = img.split()[3]
    bbox = alpha.getbbox()
    if bbox:
        # 2px 여백을 두고 크롭
        l, t, r, b = bbox
        l = max(0, l - 2); t = max(0, t - 2)
        r = min(img.width, r + 2); b = min(img.height, b + 2)
        if r - l >= 8 and b - t >= 8:   # 내용이 사실상 없으면 크롭 안 함
            img = img.crop((l, t, r, b))
    if max(img.size) > MAX_SIDE:
        k = MAX_SIDE / max(img.size)
        img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))),
                         Image.LANCZOS)
    return img


with open("emblems.json", encoding="utf-8") as f:
    emblems = json.load(f)

ok, fail = 0, []
for i, (code, url) in enumerate(sorted(emblems.items())):
    out_path = os.path.join(OUT_DIR, f"{code}.png")
    if os.path.exists(out_path):
        ok += 1
        continue
    data = None
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            data = urllib.request.urlopen(req, timeout=30).read()
            break
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(8 * (attempt + 1))
                continue
            fail.append((code, str(e)[:50]))
            break
        except Exception as e:
            fail.append((code, str(e)[:50]))
            break
    if data is None:
        if not any(c == code for c, _ in fail):
            fail.append((code, "429 retries exhausted"))
        continue
    try:
        process(data).save(out_path)
        ok += 1
    except Exception as e:
        fail.append((code, "process: " + str(e)[:40]))
    time.sleep(1.2)
    if (i + 1) % 30 == 0:
        print(f"{i + 1}/{len(emblems)} 처리 (성공 {ok})")

print(f"완료: {ok}/{len(emblems)}")
if fail:
    print("실패:", fail)
