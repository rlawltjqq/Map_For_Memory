# -*- coding: utf-8 -*-
"""일본 도도부현 문장(紋章) 수집 → emblems/{코드}.png + emblems.json 갱신

ko.wikipedia 각 도도부현 문서의 인포박스 '문장'(없으면 '기') 파일을 받아
흰 배경을 제거하고 저장한다. (도도부현 문장은 공공 상징물)
"""
import io
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import deque

from PIL import Image

API = "https://ko.wikipedia.org/w/api.php"
HEADERS = {"User-Agent": "MapForMemory/1.0 (personal hobby project)"}
OUT_DIR = "emblems"
THR, MAX_SIDE = 235, 96
FILE_RE = {
    "문장": re.compile(r"\|\s*문장\s*=\s*\[\[\s*(?:파일|File):([^|\]]+)", re.I),
    "휘장": re.compile(r"\|\s*휘장\s*=\s*\[\[\s*(?:파일|File):([^|\]]+)", re.I),
    "기": re.compile(r"\|\s*기\s*=\s*\[\[\s*(?:파일|File):([^|\]]+)", re.I),
}

os.makedirs(OUT_DIR, exist_ok=True)


def http_get(url, retries=6):
    for attempt in range(retries):
        try:
            return urllib.request.urlopen(
                urllib.request.Request(url, headers=HEADERS), timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                time.sleep(5 * (attempt + 1))
                continue
            raise
    return b""


def export_wikitexts(titles, batch=10):
    out = {}
    for i in range(0, len(titles), batch):
        chunk = titles[i:i + batch]
        params = urllib.parse.urlencode({
            "action": "query", "export": 1, "exportnowrap": 1, "titles": "|".join(chunk)})
        root = ET.fromstring(http_get(API + "?" + params))
        for page in root.iter():
            if not page.tag.endswith("}page"):
                continue
            t = x = None
            for el in page.iter():
                tag = el.tag.split("}")[-1]
                if tag == "title":
                    t = el.text
                elif tag == "text":
                    x = el.text
            if t:
                out[t] = x or ""
        time.sleep(0.8)
    return out


def thumb_url(filename, width=128):
    params = urllib.parse.urlencode({
        "action": "query", "titles": f"File:{filename}", "prop": "imageinfo",
        "iiprop": "url", "iiurlwidth": width, "format": "json",
        "formatversion": 2, "redirects": 1})
    d = json.loads(http_get(API + "?" + params))
    pages = d.get("query", {}).get("pages", [])
    if pages and pages[0].get("imageinfo"):
        info = pages[0]["imageinfo"][0]
        return info.get("thumburl") or info.get("url")
    return None


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
    img = strip_white_bg(Image.open(io.BytesIO(data)))
    bbox = img.split()[3].getbbox()
    if bbox:
        l, t, r, b = bbox
        l, t = max(0, l - 2), max(0, t - 2)
        r, b = min(img.width, r + 2), min(img.height, b + 2)
        if r - l >= 8 and b - t >= 8:
            img = img.crop((l, t, r, b))
    if max(img.size) > MAX_SIDE:
        k = MAX_SIDE / max(img.size)
        img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))),
                         Image.LANCZOS)
    return img


with open("japan_meta.json", encoding="utf-8") as f:
    names = json.load(f)["names"]          # code -> 한국어 이름
code_of = {v: k for k, v in names.items()}

texts = export_wikitexts(list(code_of.keys()))
picked = {}
for name, code in code_of.items():
    wt = texts.get(name, "")
    for key in ("문장", "휘장", "기"):
        m = FILE_RE[key].search(wt)
        if m:
            fn = m.group(1).strip().replace("_", " ")
            if re.search(r"\.(svg|png|jpe?g|gif)$", fn, re.I):
                picked[code] = fn
                break
print(f"문장 파일 확보: {len(picked)}/{len(code_of)}")
missing = [n for n, c in code_of.items() if c not in picked]
if missing:
    print("미확보:", ", ".join(missing))

try:
    with open("emblems.json", encoding="utf-8") as f:
        emblems = json.load(f)
except FileNotFoundError:
    emblems = {}

ok, fail = 0, []
for i, (code, fn) in enumerate(sorted(picked.items())):
    out_path = os.path.join(OUT_DIR, f"{code}.png")
    if os.path.exists(out_path):
        emblems[code] = f"emblems/{code}.png"
        ok += 1
        continue
    try:
        url = thumb_url(fn)
        if not url:
            fail.append((code, "no thumb"))
            continue
        process(http_get(url)).save(out_path)
        emblems[code] = f"emblems/{code}.png"
        ok += 1
    except Exception as e:
        fail.append((code, str(e)[:50]))
    time.sleep(1.2)
    if (i + 1) % 15 == 0:
        print(f"{i + 1}/{len(picked)} 처리 (성공 {ok})")

with open("emblems.json", "w", encoding="utf-8") as f:
    json.dump(emblems, f, ensure_ascii=False, indent=1)
print(f"완료: {ok}/{len(picked)}")
if fail:
    print("실패:", fail)
