# -*- coding: utf-8 -*-
"""시·군·구 백지도 생성: 시군구 경계(가는 선) + 시도 경계(굵은 선) + 지역명 라벨"""
import json
import math

W, H = 800, 1100
PAD = 20
SIMPLIFY_TOL = 0.002
MIN_RING_AREA = 0.0008

PROV_SHORT = {"서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천",
              "광주광역시": "광주", "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종",
              "경기도": "경기", "강원도": "강원", "충청북도": "충북", "충청남도": "충남",
              "전라북도": "전북", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남",
              "제주특별자치도": "제주"}


def dp_simplify(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i0, i1 = stack.pop()
        x0, y0 = pts[i0]
        x1, y1 = pts[i1]
        dx, dy = x1 - x0, y1 - y0
        seg = math.hypot(dx, dy)
        dmax, imax = 0.0, -1
        for i in range(i0 + 1, i1):
            x, y = pts[i]
            if seg == 0:
                d = math.hypot(x - x0, y - y0)
            else:
                d = abs(dy * x - dx * y + x1 * y0 - y1 * x0) / seg
            if d > dmax:
                dmax, imax = d, i
        if dmax > tol:
            keep[imax] = True
            stack.append((i0, imax))
            stack.append((imax, i1))
    return [p for p, k in zip(pts, keep) if k]


def ring_area(pts):
    a = 0.0
    for i in range(len(pts) - 1):
        a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    return abs(a) / 2


def ring_centroid(pts):
    a = cx = cy = 0.0
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        cr = x0 * y1 - x1 * y0
        a += cr
        cx += (x0 + x1) * cr
        cy += (y0 + y1) * cr
    if a == 0:
        return pts[0]
    a /= 2
    return cx / (6 * a), cy / (6 * a)


def load_features(path):
    with open(path, encoding="utf-8") as f:
        gj = json.load(f)
    out = []
    for feat in gj["features"]:
        geom = feat["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        rings_raw = [ring for poly in polys for ring in poly]
        rings_raw.sort(key=ring_area, reverse=True)
        rings = []
        for i, ring in enumerate(rings_raw):
            if i > 0 and ring_area(ring) < MIN_RING_AREA:
                continue
            simp = dp_simplify(ring, SIMPLIFY_TOL)
            if len(simp) >= 4:
                rings.append(simp)
        out.append((feat["properties"], rings))
    return out


muni = load_features("korea_municipalities.geojson")
prov = load_features("korea_provinces.geojson")

minx = miny = 1e9
maxx = maxy = -1e9
for _, rings in prov:
    for ring in rings:
        for x, y in ring:
            minx, maxx = min(minx, x), max(maxx, x)
            miny, maxy = min(miny, y), max(maxy, y)

lat_mid = math.radians((miny + maxy) / 2)
kx = math.cos(lat_mid)
span_x = (maxx - minx) * kx
span_y = maxy - miny
scale = min((W - 2 * PAD) / span_x, (H - 2 * PAD) / span_y)
ox = (W - span_x * scale) / 2
oy = (H - span_y * scale) / 2


def tr(x, y):
    return round(ox + (x - minx) * kx * scale, 1), round(oy + (maxy - y) * scale, 1)


def to_path(props, rings, with_fill_id=True):
    d_parts = []
    for ring in rings:
        pts = [tr(x, y) for x, y in ring]
        d_parts.append("M" + " L".join(f"{x} {y}" for x, y in pts) + " Z")
    if not d_parts:
        return None
    attrs = f'data-name="{props["name"]}" data-code="{props["code"]}"'
    if with_fill_id:
        attrs = f'id="m{props["code"]}" ' + attrs
    return f'  <path {attrs} d="{" ".join(d_parts)}"/>'


def label_of(props, rings, text):
    # 가장 큰 링의 무게중심에 라벨, data-w = 그 링의 투영 폭 (라벨 표시 여부 판단용)
    main = rings[0]
    cx, cy = tr(*ring_centroid(main))
    xs = [tr(x, y)[0] for x, y in main]
    w = round(max(xs) - min(xs), 1)
    return f'  <text x="{cx}" y="{cy}" dy=".35em" data-w="{w}" data-code="{props["code"]}">{text}</text>'


muni_paths, muni_labels = [], []
for props, rings in muni:
    if not rings:
        continue
    muni_paths.append(to_path(props, rings))
    muni_labels.append(label_of(props, rings, props["name"]))

prov_paths, prov_labels = [], []
for props, rings in prov:
    if not rings:
        continue
    prov_paths.append(to_path(props, rings, with_fill_id=False))
    prov_labels.append(label_of(props, rings, PROV_SHORT.get(props["name"], props["name"])))

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<g id="municipalities" fill="#ffffff" stroke="#999999" stroke-width="0.6" stroke-linejoin="round">
{chr(10).join(muni_paths)}
</g>
<g id="provinces" fill="none" stroke="#333333" stroke-width="1.4" stroke-linejoin="round" pointer-events="none">
{chr(10).join(prov_paths)}
</g>
<g id="muniLabels" font-family="sans-serif" fill="#333" text-anchor="middle" pointer-events="none" stroke="#ffffff" stroke-width="2.5" paint-order="stroke" stroke-linejoin="round">
{chr(10).join(muni_labels)}
</g>
<g id="provLabels" font-family="sans-serif" font-weight="700" fill="#111" text-anchor="middle" pointer-events="none" stroke="#ffffff" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round">
{chr(10).join(prov_labels)}
</g>
</svg>
'''
with open("korea_sigungu_map.svg", "w", encoding="utf-8") as f:
    f.write(svg)
print(f"municipalities={len(muni_paths)} provinces={len(prov_paths)} labels={len(muni_labels) + len(prov_labels)}")
