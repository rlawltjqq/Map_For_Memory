# -*- coding: utf-8 -*-
"""korea_sigungu_map.svg + 시도 정보 -> index.html (여행 지도 웹페이지)"""
import hashlib
import json
import re

def prep_svg(text, svg_id):
    """페이지용으로 svg 태그 정리 + 그룹에 공통 class 부여(나라별 id 충돌 방지)"""
    text = text.replace('width="800" height="1100"', f'id="{svg_id}" class="mapsvg"', 1)
    for gid, cls in (("municipalities", "g-munis"), ("provinces", "g-provinces"),
                     ("muniLabels", "g-labels"), ("provLabels", "g-provlabels")):
        text = text.replace(f'<g id="{gid}"', f'<g class="{cls}"', 1)
    return text


with open("korea_sigungu_map.svg", encoding="utf-8") as f:
    svg = prep_svg(f.read(), "map")

with open("japan_map.svg", encoding="utf-8") as f:
    svg_jp = prep_svg(f.read(), "mapJp")

with open("japan_meta.json", encoding="utf-8") as f:
    jp_meta = json.load(f)

# 시도 코드 -> 짧은 이름. 원본 geojson은 대용량이라 저장소에 없으므로(자동 갱신
# 워크플로에서도 빌드해야 한다) 뽑아둔 작은 파일을 쓰고, 없을 때만 원본에서 만든다.
short = {"서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천",
         "광주광역시": "광주", "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종",
         "경기도": "경기", "강원도": "강원", "충청북도": "충북", "충청남도": "충남",
         "전라북도": "전북", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남",
         "제주특별자치도": "제주"}
try:
    with open("prov_short.json", encoding="utf-8") as f:
        prov_short = json.load(f)
except FileNotFoundError:
    with open("korea_provinces.geojson", encoding="utf-8") as f:
        prov_gj = json.load(f)
    prov_short = {p["code"]: short.get(p["name"], p["name"])
                  for p in (feat["properties"] for feat in prov_gj["features"])}
    with open("prov_short.json", "w", encoding="utf-8") as f:
        json.dump(prov_short, f, ensure_ascii=False, indent=1)

with open("page_template.html", encoding="utf-8") as f:
    html = f.read()

import os

try:
    with open("emblems.json", encoding="utf-8") as f:
        emblems = json.load(f)
except FileNotFoundError:
    emblems = {}

# 흰 배경을 제거해 둔 로컬 PNG가 있으면 그쪽을 우선 사용 (없으면 원격 URL 유지)
emblems = {
    code: (f"emblems/{code}.png" if os.path.exists(f"emblems/{code}.png") else url)
    for code, url in emblems.items()
}

# 지도에 없는 코드(예: 도쿄 통합 후 남은 시·구)는 페이지에 넣지 않는다.
# 파일은 그대로 두어 SPLIT_TOKYO를 다시 켜면 재사용된다.
map_codes = set(re.findall(r'data-code="(\d+)"', svg + svg_jp))
dropped = len(emblems) - len(map_codes & set(emblems))
emblems = {c: u for c, u in emblems.items() if c in map_codes}

# ---- 축제: 지역 이름 -> 지도 코드로 변환 ----
# 이름은 사람이 쓰기 편하지만 코드가 있어야 지도와 연결된다. 같은 이름(중구·남구 등)이
# 여러 시도에 있으므로 prov로 구분하고, 하나로 좁혀지지 않으면 빌드를 멈춘다.
name_to_codes = {}
for m in re.finditer(r'data-name="([^"]+)" data-code="(\d+)"', svg + svg_jp):
    name_to_codes.setdefault(m.group(1), []).append(m.group(2))


def resolve_festivals():
    try:
        with open("festivals.json", encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        return []
    try:
        with open("festival_photo_index.json", encoding="utf-8") as f:
            photos = json.load(f)
    except FileNotFoundError:
        photos = {}
    out = []
    for country in ("kr", "jp"):
        for fes in raw.get(country, []):
            code = resolve_region(fes, f'축제 {fes["name"]}')
            item = {"n": fes["name"], "c": code, "m": fes["months"],
                    "t": fes["tag"], "d": fes["desc"]}
            if fes.get("start") and fes.get("end"):
                item["s"], item["e"] = fes["start"], fes["end"]   # 실제 개최 일정
            ph = photos.get(fes["name"])
            if ph and os.path.exists(os.path.join("festival_photos", ph["file"])):
                # 위키미디어 사진은 대개 저작자 표기가 필요해 출처를 함께 싣는다
                item["p"] = "festival_photos/" + ph["file"]
                item["cr"] = " / ".join(x for x in (ph.get("author"), ph.get("license")) if x)
            out.append(item)
    return out


def resolve_region(entry, label):
    """{region, prov} -> 지도 코드. 하나로 좁혀지지 않으면 빌드를 멈춘다."""
    cands = name_to_codes.get(entry["region"], [])
    if len(cands) > 1 and entry.get("prov"):
        cands = [c for c in cands if prov_short.get(c[:2]) == entry["prov"]]
    if len(cands) != 1:
        raise SystemExit(f'{label}: "{entry["region"]}" -> {cands or "없음"}')
    return cands[0]


def resolve_trending():
    """인기 여행지 큐레이션 -> {코드: {s:점수, t:테마}} + 기준일"""
    try:
        with open("trending.json", encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        return {}, ""
    out = {}
    for country in ("kr", "jp"):
        for e in raw.get(country, []):
            out[resolve_region(e, f'인기 여행지 {e["region"]}')] = {"s": e["score"], "t": e["theme"]}
    return out, raw.get("curatedAt", "")


festivals = resolve_festivals()
trending, trending_at = resolve_trending()

try:
    with open("climate.json", encoding="utf-8") as f:
        climate = json.load(f)
except FileNotFoundError:
    climate = {}
# 지도에 없는 코드는 빼고, 소수점도 줄여 용량을 아낀다
climate = {c: v for c, v in climate.items() if c in map_codes}

html = html.replace("__CLIMATE__", json.dumps(climate, separators=(",", ":")))
html = html.replace("__FESTIVALS__", json.dumps(festivals, ensure_ascii=False, separators=(",", ":")))
html = html.replace("__TRENDING__", json.dumps(trending, ensure_ascii=False, separators=(",", ":")))
html = html.replace("__TRENDING_AT__", json.dumps(trending_at, ensure_ascii=False))
html = html.replace("__PROV__", json.dumps(prov_short, ensure_ascii=False))
html = html.replace("__PROV_JP__", json.dumps(jp_meta["regions"], ensure_ascii=False))
html = html.replace("__EMBLEMS__", json.dumps(emblems, ensure_ascii=False))
# 지도 SVG와 앱 스크립트는 따로 낸다.
# HTML은 network-first(sw.js)라 인라인이면 열 때마다 387KB를 다시 받는다.
# 별도 파일이면 캐시에 남아 재방문 때 내려받지 않는다.
with open("map_kr.svg", "w", encoding="utf-8") as f:
    f.write(svg)
with open("map_jp.svg", "w", encoding="utf-8") as f:
    f.write(svg_jp)

with open("app_template.js", encoding="utf-8") as f:
    app_js = f.read()
app_js = (app_js.replace("__PROV__", json.dumps(prov_short, ensure_ascii=False))
                .replace("__PROV_JP__", json.dumps(jp_meta["regions"], ensure_ascii=False))
                .replace("__EMBLEMS__", json.dumps(emblems, ensure_ascii=False))
                .replace("__CLIMATE__", json.dumps(climate, separators=(",", ":")))
                .replace("__FESTIVALS__", json.dumps(festivals, ensure_ascii=False, separators=(",", ":")))
                .replace("__TRENDING__", json.dumps(trending, ensure_ascii=False, separators=(",", ":")))
                .replace("__TRENDING_AT__", json.dumps(trending_at, ensure_ascii=False)))
with open("app.js", "w", encoding="utf-8") as f:
    f.write(app_js)

# 캐시를 확실히 갈아끼우도록 파일 내용으로 빌드 번호를 만든다
build_id = hashlib.sha256((app_js + svg + svg_jp).encode()).hexdigest()[:8]
html = html.replace("__BUILD__", build_id)

with open("index.html", "w", encoding="utf-8") as f:
    f.write(html)
print(f"index.html {len(html)//1024}KB / app.js {len(app_js)//1024}KB / "
      f"map_kr.svg {len(svg)//1024}KB / map_jp.svg {len(svg_jp)//1024}KB "
      f"(build {build_id}, 미사용 심벌 {dropped}개 제외)")
