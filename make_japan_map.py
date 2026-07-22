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

# 도쿄도는 시·구 단위로 분할 (섬 지역 제외: JIS 13308 이하만)
TOKYO_KO = {
    "13101": "지요다구", "13102": "주오구", "13103": "미나토구", "13104": "신주쿠구",
    "13105": "분쿄구", "13106": "다이토구", "13107": "스미다구", "13108": "고토구",
    "13109": "시나가와구", "13110": "메구로구", "13111": "오타구", "13112": "세타가야구",
    "13113": "시부야구", "13114": "나카노구", "13115": "스기나미구", "13116": "도시마구",
    "13117": "기타구", "13118": "아라카와구", "13119": "이타바시구", "13120": "네리마구",
    "13121": "아다치구", "13122": "가쓰시카구", "13123": "에도가와구",
    "13201": "하치오지시", "13202": "다치카와시", "13203": "무사시노시", "13204": "미타카시",
    "13205": "오메시", "13206": "후추시", "13207": "아키시마시", "13208": "조후시",
    "13209": "마치다시", "13210": "고가네이시", "13211": "고다이라시", "13212": "히노시",
    "13213": "히가시무라야마시", "13214": "고쿠분지시", "13215": "구니타치시",
    "13218": "훗사시", "13219": "고마에시", "13220": "히가시야마토시", "13221": "기요세시",
    "13222": "히가시쿠루메시", "13223": "무사시무라야마시", "13224": "다마시",
    "13225": "이나기시", "13227": "하무라시", "13228": "아키루노시", "13229": "니시토쿄시",
    "13303": "미즈호마치", "13305": "히노데마치", "13307": "히노하라무라", "13308": "오쿠타마마치",
}
TOKYO_PID = 13
TOKYO_GROUP = "9T"          # 통계 그룹 키 (도쿄)
TOKYO_TOL = 0.0004          # 구는 작아서 단순화 강도를 낮춤
TOKYO_MIN_AREA = 0.000002
SPLIT_TOKYO = False         # True면 도쿄를 시·구로 분할, False면 도(都) 하나로


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
    if SPLIT_TOKYO and pid == TOKYO_PID:
        continue          # 분할 모드일 때만 도쿄를 시·구 단위로 따로 처리
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

# --- 도쿄 시·구 (SPLIT_TOKYO 일 때만) ---
tokyo = {}   # JIS코드 -> [rings]
if SPLIT_TOKYO:
    with open("tokyo_raw.json", encoding="utf-8") as f:
        tgj = json.load(f)
else:
    tgj = {"features": []}
for feat in tgj["features"]:
    jis = str(feat["properties"].get("N03_007") or "")
    if jis not in TOKYO_KO:
        continue
    geom = feat["geometry"]
    if not geom:
        continue
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    rings_raw = [r for poly in polys for r in poly]
    rings_raw.sort(key=ring_area, reverse=True)
    rings = []
    for i, r in enumerate(rings_raw):
        if i > 0 and ring_area(r) < TOKYO_MIN_AREA:
            continue
        s = dp_simplify(r, TOKYO_TOL)
        if len(s) >= 4:
            rings.append(s)
    if rings:
        tokyo.setdefault(jis, []).extend(rings)

# 화면 범위: 각 현의 '가장 큰 링'만으로 산출 (멀리 떨어진 외딴 섬 제외)
minx = miny = 1e9
maxx = maxy = -1e9
for rings in list(prefs.values()) + list(tokyo.values()):
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


paths, labels, meta, groups_of = [], [], {}, {}


def emit(code, name, rings, group):
    """SVG path + 라벨 + 메타 추가"""
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
    groups_of[code] = group


for jis in sorted(tokyo):
    emit("9" + jis, TOKYO_KO[jis], tokyo[jis], TOKYO_GROUP)

for pid in sorted(prefs):
    rings = prefs[pid]
    region = REGION_OF[pid]
    code = str(90000 + region * 1000 + pid)
    name = PREF_KO[pid]
    groups_of[code] = str(90 + region)
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
regions_out[TOKYO_GROUP] = "도쿄"
with open("japan_meta.json", "w", encoding="utf-8") as f:
    json.dump({"names": meta, "regions": regions_out, "groups": groups_of},
              f, ensure_ascii=False, indent=1)

print(f"일본 지역 {len(paths)}개 (도쿄 시·구 {len(tokyo)}개 포함), 그룹 {len(regions_out)}개")
