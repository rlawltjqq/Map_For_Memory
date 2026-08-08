# -*- coding: utf-8 -*-
"""날씨를 조회할 지점을 지역마다 '사람이 사는 저지대'로 고른다.

라벨 좌표는 이름을 넣기 좋은 '가장 넓은 자리'라 강릉·서귀포처럼 산을 낀 지역은
내륙 산지에 찍힌다. 그 지점의 기후는 도심과 크게 달라(강릉 734m) 추천이 뒤집힌다.
지역 안에 후보 점을 여러 개 만들고 표고가 가장 낮은 곳을 고른다.
"""
import json
import time
import urllib.parse
import urllib.request

import make_sigungu_map as M

CAND = 9          # 지역당 후보 점 수
BATCH = 100       # 표고 API 한 번에 보낼 좌표 수


def candidates(rings):
    """도형 안쪽에 고르게 퍼진 후보 점들 (가로선을 여러 높이로 그어 구간 중앙을 딴다)"""
    ys = [p[1] for r in rings for p in r]
    y0, y1 = min(ys), max(ys)
    closed = [r if r[0] == r[-1] else r + [r[0]] for r in rings]
    spans = []
    for i in range(1, 40):
        y = y0 + (y1 - y0) * i / 40
        xs = []
        for rr in closed:
            for (ax, ay), (bx, by) in zip(rr, rr[1:]):
                if (ay > y) != (by > y):
                    xs.append((bx - ax) * (y - ay) / (by - ay) + ax)
        xs.sort()
        spans += [(b - a, (a + b) / 2, y) for a, b in zip(xs[0::2], xs[1::2])]
    if not spans:
        return []
    spans.sort(key=lambda s: -s[0])          # 넓은 구간 우선 (바늘 같은 곳 제외)
    picked = []
    for w, x, y in spans:
        if all(abs(x - px) > 0.03 or abs(y - py) > 0.03 for px, py in picked):
            picked.append((x, y))
        if len(picked) >= CAND:
            break
    return picked


def elevations(points):
    out = []
    for i in range(0, len(points), BATCH):
        chunk = points[i:i + BATCH]
        qs = urllib.parse.urlencode({
            "latitude": ",".join(f"{y:.4f}" for _, y in chunk),
            "longitude": ",".join(f"{x:.4f}" for x, _ in chunk),
        })
        for attempt in range(6):
            try:
                with urllib.request.urlopen(
                        "https://api.open-meteo.com/v1/elevation?" + qs, timeout=90) as r:
                    out += json.load(r)["elevation"]
                break
            except Exception as e:
                print(f"  재시도 {attempt+1}/6 ({e})")
                time.sleep(20 * (attempt + 1))
        else:
            out += [None] * len(chunk)
        print(f"  표고 {min(i + BATCH, len(points))}/{len(points)}")
        time.sleep(1)
    return out


def main():
    final = M.refine(M.merge_general_gu(M.load_features("korea_municipalities.geojson")))
    flat, index = [], {}
    for props, rings in final:
        if not rings:
            continue
        pts = candidates(rings)
        index[props["code"]] = (len(flat), len(pts))
        flat += pts
    print(f"지역 {len(index)}곳, 후보 점 {len(flat)}개")
    el = elevations(flat)

    old = json.load(open("korea_coords.json", encoding="utf-8"))
    new, moved = {}, []
    for code, (off, n) in index.items():
        cands = [(el[off + i], flat[off + i]) for i in range(n) if el[off + i] is not None]
        if not cands:
            new[code] = old[code]
            continue
        h, (x, y) = min(cands, key=lambda c: c[0])
        new[code] = [round(x, 3), round(y, 3)]
        cur = old.get(code)
        if cur and (abs(cur[0] - x) > 0.01 or abs(cur[1] - y) > 0.01):
            moved.append((code, h))
    with open("korea_coords.json", "w", encoding="utf-8") as f:
        json.dump(new, f, indent=1)
    with open("moved_codes.json", "w", encoding="utf-8") as f:
        json.dump([c for c, _ in moved], f)
    print(f"지점이 바뀐 지역 {len(moved)}곳 -> moved_codes.json")


if __name__ == "__main__":
    main()
