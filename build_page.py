# -*- coding: utf-8 -*-
"""korea_sigungu_map.svg + 시도 정보 -> index.html (여행 지도 웹페이지)"""
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

with open("korea_provinces.geojson", encoding="utf-8") as f:
    prov_gj = json.load(f)
prov_names = {}
for feat in prov_gj["features"]:
    p = feat["properties"]
    prov_names[p["code"]] = p["name"]

# 짧은 표시용 이름
short = {"서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천",
         "광주광역시": "광주", "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종",
         "경기도": "경기", "강원도": "강원", "충청북도": "충북", "충청남도": "충남",
         "전라북도": "전북", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남",
         "제주특별자치도": "제주"}
prov_short = {code: short.get(name, name) for code, name in prov_names.items()}

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
    out, problems = [], []
    for country in ("kr", "jp"):
        for fes in raw.get(country, []):
            cands = name_to_codes.get(fes["region"], [])
            if len(cands) > 1 and fes.get("prov"):
                cands = [c for c in cands if prov_short.get(c[:2]) == fes["prov"]]
            if len(cands) != 1:
                problems.append(f'{fes["name"]}: "{fes["region"]}" -> {cands or "없음"}')
                continue
            out.append({"n": fes["name"], "c": cands[0], "m": fes["months"],
                        "t": fes["tag"], "d": fes["desc"]})
    if problems:
        raise SystemExit("축제 지역을 지도 코드로 못 찾음:\n  " + "\n  ".join(problems))
    return out


festivals = resolve_festivals()

try:
    with open("climate.json", encoding="utf-8") as f:
        climate = json.load(f)
except FileNotFoundError:
    climate = {}
# 지도에 없는 코드는 빼고, 소수점도 줄여 용량을 아낀다
climate = {c: v for c, v in climate.items() if c in map_codes}

html = html.replace("__CLIMATE__", json.dumps(climate, separators=(",", ":")))
html = html.replace("__FESTIVALS__", json.dumps(festivals, ensure_ascii=False, separators=(",", ":")))
html = html.replace("__PROV__", json.dumps(prov_short, ensure_ascii=False))
html = html.replace("__PROV_JP__", json.dumps(jp_meta["regions"], ensure_ascii=False))
html = html.replace("__EMBLEMS__", json.dumps(emblems, ensure_ascii=False))
html = html.replace("__SVG__", svg)
html = html.replace("__SVG_JP__", svg_jp)

with open("index.html", "w", encoding="utf-8") as f:
    f.write(html)
print(f"index.html written, {len(html)} bytes (미사용 심벌 {dropped}개 제외)")
