# -*- coding: utf-8 -*-
"""시·군·구 백지도 생성: 시군구 경계(가는 선) + 시도 경계(굵은 선) + 지역명 라벨"""
import json
import math

from svgutil import SCALE, bbox_of, path_d, q

W, H = 800, 1100
PAD = 20
SIMPLIFY_TOL = 0.002
MIN_RING_AREA = 0.00005

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


DOKDO_LON_MIN = 131.5      # 이 경도보다 동쪽 = 독도
DOKDO_MIN_UNITS = 4.5      # 전국 뷰에서 보이도록 최소 표시 크기(SVG 단위)


def is_dokdo(ring):
    return min(p[0] for p in ring) > DOKDO_LON_MIN


def load_features(path):
    """GeoJSON을 원본 좌표 그대로 읽는다 (선 단순화·작은 섬 제거는 refine에서)."""
    with open(path, encoding="utf-8") as f:
        gj = json.load(f)
    out = []
    for feat in gj["features"]:
        geom = feat["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        rings = [ring for poly in polys for ring in poly]
        rings.sort(key=ring_area, reverse=True)
        out.append((feat["properties"], rings))
    return out


def refine(features):
    """작은 섬을 걸러내고 선을 단순화한다.

    반드시 merge_general_gu 뒤에 호출할 것. 구별로 먼저 단순화하면 맞닿은 경계의
    좌표가 서로 어긋나 합집합이 내부 경계를 못 지우고 도형이 깨진다.
    """
    out = []
    for props, rings_raw in features:
        rings_raw.sort(key=ring_area, reverse=True)
        rings = []
        for i, ring in enumerate(rings_raw):
            dok = is_dokdo(ring)
            # 독도는 아주 작아 일반 필터·단순화에 사라지므로 예외 처리
            if i > 0 and not dok and ring_area(ring) < MIN_RING_AREA:
                continue
            # 단순화 강도를 섬 크기에 맞춘다. 본토 기준 강도를 작은 섬에 그대로
            # 쓰면 삼각형으로 뭉개지거나 점이 모자라 아예 사라진다.
            if dok:
                tol = 0.00005
            else:
                span = max(max(p[0] for p in ring) - min(p[0] for p in ring),
                           max(p[1] for p in ring) - min(p[1] for p in ring))
                tol = min(SIMPLIFY_TOL, span / 25)
            simp = dp_simplify(ring, tol)
            if len(simp) >= 4:
                rings.append(simp)
        out.append((props, rings))
    return out


def merge_general_gu(features):
    """일반구(전주시완산구·용인시수지구 등)를 모도시 하나로 합친다.

    구끼리 맞닿은 내부 경계선은 '두 링이 공유하는 변'을 지우는 방식으로 제거한다.
    (광역시의 자치구는 이름이 '○○시○○구' 형태가 아니므로 영향받지 않는다.)
    """
    import re as _re
    from collections import defaultdict

    groups, singles = defaultdict(list), []
    for props, rings in features:
        m = _re.match(r"^(.+?시)(.+구)$", props["name"])
        if m and rings:
            groups[m.group(1)].append((props, rings))
        else:
            singles.append((props, rings))

    merged = []
    for city, members in groups.items():
        if len(members) == 1:                      # 구가 하나뿐이면 이름만 정리
            props, rings = members[0]
            props = dict(props, name=city)
            merged.append((props, rings))
            continue
        # 대표 코드: 가장 작은 코드(보통 시 본청 기준)
        members.sort(key=lambda mp: mp[0]["code"])
        base = dict(members[0][0], name=city)
        all_rings = [r for _, rings in members for r in rings]
        merged.append((base, union_rings(all_rings)))

    return singles + merged


def signed_area(pts):
    a = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        a += x0 * y1 - x1 * y0
    return a / 2


def union_rings(rings):
    """여러 폴리곤을 하나로 합친다.

    모든 링의 회전 방향을 맞춰 놓으면, 두 구가 맞댄 내부 경계는 같은 변이 서로
    '반대 방향'으로 한 번씩 나타난다. 이 쌍을 상쇄시키고 남은 변만 이어 붙이면
    바깥 외곽선만 남는다.
    """
    from collections import Counter, defaultdict

    def key(p):
        return (round(p[0], 7), round(p[1], 7))

    edges = Counter()
    for ring in rings:
        pts = [key(p) for p in ring]
        if pts[0] != pts[-1]:
            pts.append(pts[0])
        if signed_area(pts) < 0:          # 회전 방향을 반시계로 통일
            pts.reverse()
        for a, b in zip(pts, pts[1:]):
            if a == b:
                continue
            if edges[(b, a)]:             # 반대 방향 변 = 내부 경계 → 상쇄
                edges[(b, a)] -= 1
            else:
                edges[(a, b)] += 1

    nxt = defaultdict(list)
    for (a, b), n in edges.items():
        nxt[a].extend([b] * n)

    out = []
    for start in list(nxt):
        while nxt[start]:
            loop, cur = [start], nxt[start].pop()
            while cur != start and nxt[cur]:
                loop.append(cur)
                cur = nxt[cur].pop()
            if cur == start and len(loop) >= 3:   # 닫힌 고리만 사용
                loop.append(loop[0])
                out.append([list(p) for p in loop])
    out.sort(key=ring_area, reverse=True)
    # 합쳐지지 않았다면(예외) 원본을 그대로 사용
    return out if out else rings


muni = refine(merge_general_gu(load_features("korea_municipalities.geojson")))
prov = refine(load_features("korea_provinces.geojson"))

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


def enlarge_dokdo(features):
    """독도는 실제 크기가 1px 미만이라 전국 뷰에서 안 보인다.
    지도에 표시되도록 중심을 유지한 채 최소 크기까지만 확대한다."""
    for props, rings in features:
        dok = [r for r in rings if is_dokdo(r)]
        if not dok:
            continue
        pts = [p for r in dok for p in r]
        cx = (min(p[0] for p in pts) + max(p[0] for p in pts)) / 2
        cy = (min(p[1] for p in pts) + max(p[1] for p in pts)) / 2
        span_lon = max(p[0] for p in pts) - min(p[0] for p in pts)
        cur_units = span_lon * kx * scale
        if cur_units <= 0 or cur_units >= DOKDO_MIN_UNITS:
            continue
        k = DOKDO_MIN_UNITS / cur_units
        for r in dok:
            for p in r:
                p[0] = cx + (p[0] - cx) * k
                p[1] = cy + (p[1] - cy) * k


enlarge_dokdo(muni)
enlarge_dokdo(prov)


def to_path(props, rings, with_fill_id=True):
    d = path_d(rings, tr)
    if not d:
        return None
    attrs = f'data-name="{props["name"]}" data-code="{props["code"]}"'
    if with_fill_id:
        attrs = f'id="m{props["code"]}" ' + attrs
    return f'  <path {attrs} d="{d}"/>'


def point_in_rings(pt, rings):
    x, y = pt
    hit = False
    for r in rings:
        rr = r if r[0] == r[-1] else r + [r[0]]
        for (x0, y0), (x1, y1) in zip(rr, rr[1:]):
            if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
                hit = not hit
    return hit


def interior_point(rings, near=None):
    """이름을 실제로 쓸 수 있는 라벨 자리와, 그 자리의 가로 폭.

    가로선을 여러 개 그어 도형 내부 구간을 모은 뒤 가장 넓은 곳을 고른다.
    무게중심은 초승달(달성군)·도넛(청원군)·분리형 지역에서 도형 밖이나 좁은
    목에 떨어지는데, 그러면 이름이 옆 동네에 찍히거나 표시 규칙이 폭을 과대
    평가해 글자가 지역을 넘친다.

    모든 링의 교차점을 한 번에 모아 짝지으므로 구멍(청원군 안의 청주시)과
    떨어진 조각은 자연히 제외된다. near를 주면 비슷하게 넓은 자리 중
    그 점(보통 무게중심)에 가장 가까운 곳을 골라 라벨이 괜히 튀지 않게 한다.
    """
    ys = [p[1] for r in rings for p in r]
    y0, y1 = min(ys), max(ys)
    closed = [r if r[0] == r[-1] else r + [r[0]] for r in rings]
    spans = []
    for i in range(1, 120):
        y = y0 + (y1 - y0) * i / 120
        xs = []
        for rr in closed:
            for (ax, ay), (bx, by) in zip(rr, rr[1:]):
                if (ay > y) != (by > y):
                    xs.append((bx - ax) * (y - ay) / (by - ay) + ax)
        xs.sort()
        spans += [(b - a, (a + b) / 2, y) for a, b in zip(xs[0::2], xs[1::2])]
    if not spans:
        return None
    widest = max(s[0] for s in spans)
    if near is None:
        return max(spans, key=lambda s: s[0])
    # 최대 폭의 90% 이상인 자리들 중 무게중심에 가장 가까운 곳
    good = [s for s in spans if s[0] >= widest * 0.9]
    return min(good, key=lambda s: math.hypot(s[1] - near[0], s[2] - near[1]))


def label_of(props, rings, text):
    # 가장 큰 링의 무게중심에 라벨, data-w/h = 그 링의 투영 크기 (라벨·마커 크기 판단용)
    main = rings[0]
    cx, cy = ring_centroid(main)
    _, _, w, h = bbox_of(main, tr)
    # data-w는 '이름이 들어갈 자리가 되는지' 판단에 쓰인다. bbox 폭은 초승달·
    # 분리형 지역에서 실제 여유보다 크게 나오므로, 라벨 자리의 실제 내부 폭을 쓴다.
    best = interior_point(rings, near=(cx, cy))
    if best:
        span, cx, cy = best
        w = min(w, q(span * kx * scale))
    px, py = tr(cx, cy)
    return (f'  <text x="{q(px)}" y="{q(py)}" dy=".35em" data-w="{w}" data-h="{h}" '
            f'data-code="{props["code"]}">{text}</text>')


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

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W * SCALE} {H * SCALE}" width="{W}" height="{H}">
<g id="municipalities" fill="#ffffff" stroke="#c6cfd9" stroke-width="5.5" stroke-linejoin="round">
{chr(10).join(muni_paths)}
</g>
<g id="provinces" fill="none" stroke="#8494a7" stroke-width="11" stroke-linejoin="round" pointer-events="none">
{chr(10).join(prov_paths)}
</g>
<g id="muniLabels" font-family="Pretendard Variable, Pretendard, -apple-system, sans-serif" fill="#4b5a6b" text-anchor="middle" pointer-events="none">
{chr(10).join(muni_labels)}
</g>
<g id="provLabels" font-family="Pretendard Variable, Pretendard, -apple-system, sans-serif" font-weight="600" fill="#3d4c5e" text-anchor="middle" pointer-events="none">
{chr(10).join(prov_labels)}
</g>
</svg>
'''
with open("korea_sigungu_map.svg", "w", encoding="utf-8") as f:
    f.write(svg)
print(f"municipalities={len(muni_paths)} provinces={len(prov_paths)} labels={len(muni_labels) + len(prov_labels)}")
