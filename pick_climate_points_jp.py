# -*- coding: utf-8 -*-
"""일본 도도부현의 날씨 조회 지점을 '사람이 사는 저지대'로 고른다.

한국에는 이미 적용한 보정인데(강릉 734m -> 47m) 일본은 무게중심을 그대로
쓰고 있었다. 홋카이도 814m, 나가노현 1525m처럼 산속 좌표라 실제 도시의
기후와 크게 달랐다. 지역 안 후보 점들의 표고를 재서 가장 낮은 곳을 쓴다.
"""
import json
import time
import urllib.parse
import urllib.request

import make_japan_map as J

CAND = 9        # 지역당 후보 점 수
BATCH = 100     # 표고 API 한 번에 보낼 좌표 수
UA = {"User-Agent": "MapForMemory/1.0"}


def candidates(rings):
    """도형 안쪽에 고르게 퍼진 후보 점 (가로선을 그어 내부 구간 중앙을 딴다)"""
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
    spans.sort(key=lambda s: -s[0])          # 넓은 구간 우선 (바늘 같은 곳 제외)
    picked = []
    for w, x, y in spans:
        if all(abs(x - px) > 0.15 or abs(y - py) > 0.15 for px, py in picked):
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
            "longitude": ",".join(f"{x:.4f}" for x, _ in chunk)})
        for attempt in range(6):
            try:
                req = urllib.request.Request(
                    "https://api.open-meteo.com/v1/elevation?" + qs, headers=UA)
                with urllib.request.urlopen(req, timeout=90) as r:
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
    # make_japan_map이 모듈 로드 중에 prefs를 채운다 (도도부현 코드 -> 링들)
    groups = {}
    for pid, rings in J.prefs.items():
        code = str(90000 + J.REGION_OF[pid] * 1000 + pid)
        groups[code] = rings

    meta = json.load(open("japan_meta.json", encoding="utf-8"))
    flat, index = [], {}
    for code, rings in groups.items():
        pts = candidates(rings)
        index[code] = (len(flat), len(pts))
        flat += pts
    print(f"도도부현 {len(index)}곳, 후보 점 {len(flat)}개")
    el = elevations(flat)

    old = dict(meta["coords"])
    moved = []
    for code, (off, n) in index.items():
        cands = [(el[off + i], flat[off + i]) for i in range(n) if el[off + i] is not None]
        if not cands:
            continue
        h, (x, y) = min(cands, key=lambda c: c[0])
        cur = old.get(code)
        meta["coords"][code] = [round(x, 3), round(y, 3)]
        if cur and (abs(cur[0] - x) > 0.01 or abs(cur[1] - y) > 0.01):
            moved.append((code, meta["names"].get(code, code), h))

    json.dump(meta, open("japan_meta.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    json.dump([c for c, _, _ in moved], open("moved_codes_jp.json", "w"), ensure_ascii=False)
    print(f"지점이 바뀐 도도부현 {len(moved)}곳")
    for c, nm, h in sorted(moved, key=lambda m: m[1])[:12]:
        print(f"  {nm} -> 표고 {h:.0f}m")


if __name__ == "__main__":
    main()
