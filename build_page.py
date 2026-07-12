# -*- coding: utf-8 -*-
"""korea_sigungu_map.svg + 시도 정보 -> index.html (여행 지도 웹페이지)"""
import json
import re

with open("korea_sigungu_map.svg", encoding="utf-8") as f:
    svg = f.read()
# 페이지에 맞게 svg 태그의 고정 width/height 제거 (viewBox만 유지)
svg = svg.replace(f'width="800" height="1100"', 'id="map"', 1)

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

html = html.replace("__PROV__", json.dumps(prov_short, ensure_ascii=False))
html = html.replace("__SVG__", svg)

with open("index.html", "w", encoding="utf-8") as f:
    f.write(html)
print("index.html written,", len(html), "bytes")
