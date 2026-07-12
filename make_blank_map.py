# -*- coding: utf-8 -*-
"""korea_provinces.geojson -> korea_blank_map.svg (시·도 경계 백지도)"""
import json
import math

W, H = 800, 1100
PAD = 20
SIMPLIFY_TOL = 0.002  # degrees (~200m), Douglas-Peucker
MIN_RING_AREA = 0.0008  # drop tiny islets (in deg^2, rough)


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


with open("korea_provinces.geojson", encoding="utf-8") as f:
    gj = json.load(f)

# collect all rings per feature
features = []
minx = miny = 1e9
maxx = maxy = -1e9
for feat in gj["features"]:
    geom = feat["geometry"]
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    rings = []
    for poly in polys:
        for ring in poly:
            if ring_area(ring) < MIN_RING_AREA:
                continue
            simp = dp_simplify(ring, SIMPLIFY_TOL)
            if len(simp) < 4:
                continue
            rings.append(simp)
            for x, y in simp:
                minx, maxx = min(minx, x), max(maxx, x)
                miny, maxy = min(miny, y), max(maxy, y)
    features.append((feat["properties"]["name"], feat["properties"]["name_eng"], rings))

# scale: equirectangular with latitude correction
lat_mid = math.radians((miny + maxy) / 2)
kx = math.cos(lat_mid)
span_x = (maxx - minx) * kx
span_y = maxy - miny
scale = min((W - 2 * PAD) / span_x, (H - 2 * PAD) / span_y)
ox = (W - span_x * scale) / 2
oy = (H - span_y * scale) / 2


def tr(x, y):
    px = ox + (x - minx) * kx * scale
    py = oy + (maxy - y) * scale
    return round(px, 1), round(py, 1)


paths = []
total_pts = 0
for name, name_eng, rings in features:
    d_parts = []
    for ring in rings:
        pts = [tr(x, y) for x, y in ring]
        total_pts += len(pts)
        d = "M" + " L".join(f"{x} {y}" for x, y in pts) + " Z"
        d_parts.append(d)
    if d_parts:
        paths.append(f'  <path id="{name_eng}" data-name="{name}" d="{" ".join(d_parts)}"/>')

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<g fill="#ffffff" stroke="#333333" stroke-width="1.2" stroke-linejoin="round">
{chr(10).join(paths)}
</g>
</svg>
'''
with open("korea_blank_map.svg", "w", encoding="utf-8") as f:
    f.write(svg)
print(f"features={len(features)} total_points={total_pts}")
