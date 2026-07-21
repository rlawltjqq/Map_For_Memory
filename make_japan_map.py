# -*- coding: utf-8 -*-
"""japan.geojson -> japan_map.svg + japan_meta.json (일본 도도부현 지도)

코드 체계: 90000 + 지방번호*1000 + 도도부현번호  (예: 도쿄 = 93013)
  → 앞 두 자리("93")가 지방 코드가 되어 한국 지도의 시·도 그룹핑과 동일하게 동작
"""
import json
import math

W, H = 800, 1100
PAD = 24
SIMPLIFY_TOL = 0.004
MIN_RING_AREA = 0.004     # 아주 작은 섬은 생략 (가장 큰 링은 항상 유지)

PREF_KO = {
    1: "홋카이도", 2: "아오모리현", 3: "이와테현", 4: "미야기현", 5: "아키타현",
    6: "야마가타현", 7: "후쿠시마현", 8: "이바라키현", 9: "도치기현", 10: "군마현",
    11: "사이타마현", 12: "지바현", 13: "도쿄도", 14: "가나가와현", 15: "니가타현",
    16: "도야마현", 17: "이시카와현", 18: "후쿠이현", 19: "야마나시현", 20: "나가노현",
    21: "기후현", 22: "시즈오카현", 23: "아이치현", 24: "미에현", 25: "시가현",
    26: "교토부", 27: "오사카부", 28: "효고현", 29: "나라현", 30: "와카야마현",
    31: "돗토리현", 32: "시마네현", 33: "오카야마현", 34: "히로시마현", 35: "야마구치현",
    36: "도쿠시마현", 37: "가가와현", 38: "에히메현", 39: "고치현", 40: "후쿠오카현",
    41: "사가현", 42: "나가사키현", 43: "구마모토현", 44: "오이타현", 45: "미야자키현",
    46: "가고시마현", 47: "오키나와현",
}
# 지방(8+오키나와) — 통계 그룹
REGIONS = {
    1: ("홋카이도", [1]),
    2: ("도호쿠", [2, 3, 4, 5, 6, 7]),
    3: ("간토", [8, 9, 10, 11, 12, 13, 14]),
    4: ("주부", [15, 16, 17, 18, 19, 20, 21, 22, 23]),
    5: ("긴키", [24, 25, 26, 27, 28, 29, 30]),
    6: ("주고쿠", [31, 32, 33, 34, 35]),
    7: ("시코쿠", [36, 37, 38, 39]),
    8: ("규슈", [40, 41, 42, 43, 44, 45, 46]),
    9: ("오키나와", [47]),
}
REGION_OF = {p: r for r, (_, ps) in REGIONS.items() for p in ps}


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
            d = (math.hypot(x - x0, y - y0) if seg == 0
                 else abs(dy * x - dx * y + x1 * y0 - y1 * x0) / seg)
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


with open("japan.geojson", encoding="utf-8") as f:
    gj = json.load(f)

prefs = {}   # id -> [rings]
for feat in gj["features"]:
    pid = feat["properties"]["id"]
    geom = feat["geometry"]
    if not geom:
        continue
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    rings_raw = [r for poly in polys for r in poly]
    rings_raw.sort(key=ring_area, reverse=True)
    rings = []
    for i, r in enumerate(rings_raw):
        if i > 0 and ring_area(r) < MIN_RING_AREA:
            continue
        s = dp_simplify(r, SIMPLIFY_TOL)
        if len(s) >= 4:
            rings.append(s)
    if rings:
        prefs.setdefault(pid, []).extend(rings)

# 화면 범위: 각 현의 '가장 큰 링'만으로 산출 (멀리 떨어진 외딴 섬 제외)
minx = miny = 1e9
maxx = maxy = -1e9
for pid, rings in prefs.items():
    main = max(rings, key=ring_area)
    for x, y in main:
        minx, maxx = min(minx, x), max(maxx, x)
        miny, maxy = min(miny, y), max(maxy, y)

# 화면 밖으로 벗어나는 외딴 섬(오가사와라·야에야마 등)은 제외 — 잘려 보이지 않게
for pid, rings in prefs.items():
    main = max(rings, key=ring_area)
    kept = []
    for r in rings:
        if r is main:
            kept.append(r)
            continue
        cx, cy = ring_centroid(r)
        if minx <= cx <= maxx and miny <= cy <= maxy:
            kept.append(r)
    prefs[pid] = kept

lat_mid = math.radians((miny + maxy) / 2)
kx = math.cos(lat_mid)
span_x = (maxx - minx) * kx
span_y = maxy - miny
scale = min((W - 2 * PAD) / span_x, (H - 2 * PAD) / span_y)
ox = (W - span_x * scale) / 2
oy = (H - span_y * scale) / 2


def tr(x, y):
    return round(ox + (x - minx) * kx * scale, 1), round(oy + (maxy - y) * scale, 1)


paths, labels, meta = [], [], {}
for pid in sorted(prefs):
    rings = prefs[pid]
    region = REGION_OF[pid]
    code = str(90000 + region * 1000 + pid)
    name = PREF_KO[pid]
    d_parts = []
    for r in rings:
        pts = [tr(x, y) for x, y in r]
        d_parts.append("M" + " L".join(f"{x} {y}" for x, y in pts) + " Z")
    paths.append(f'  <path id="m{code}" data-name="{name}" data-code="{code}" d="{" ".join(d_parts)}"/>')
    main = max(rings, key=ring_area)
    cx, cy = tr(*ring_centroid(main))
    pts = [tr(x, y) for x, y in main]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    labels.append(f'  <text x="{cx}" y="{cy}" dy=".35em" data-w="{round(max(xs) - min(xs), 1)}" '
                  f'data-h="{round(max(ys) - min(ys), 1)}" data-code="{code}">{name}</text>')
    meta[code] = name

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<g id="municipalities" fill="#ffffff" stroke="#c6cfd9" stroke-width="0.55" stroke-linejoin="round">
{chr(10).join(paths)}
</g>
<g id="provinces" fill="none" stroke="#8494a7" stroke-width="1.1" stroke-linejoin="round" pointer-events="none"></g>
<g id="muniLabels" font-family="Pretendard Variable, Pretendard, -apple-system, sans-serif" fill="#4b5a6b" text-anchor="middle" pointer-events="none">
{chr(10).join(labels)}
</g>
<g id="provLabels" font-family="Pretendard Variable, Pretendard, -apple-system, sans-serif" font-weight="600" fill="#3d4c5e" text-anchor="middle" pointer-events="none"></g>
</svg>
'''
with open("japan_map.svg", "w", encoding="utf-8") as f:
    f.write(svg)

regions_out = {str(90 + r): nm for r, (nm, _) in REGIONS.items()}
with open("japan_meta.json", "w", encoding="utf-8") as f:
    json.dump({"names": meta, "regions": regions_out}, f, ensure_ascii=False, indent=1)

print(f"도도부현 {len(paths)}개, 지방 {len(regions_out)}개")
