# -*- coding: utf-8 -*-
"""지도 SVG 공통 유틸 — 좌표 압축(정수 격자 + 상대좌표)

좌표를 10배 정수 격자로 올려 viewBox도 10배로 쓰면 화면 결과는 같으면서
"123.4 567.8" 대신 "1234 5678", 게다가 상대좌표(l)로 적어 크기를 크게 줄인다.
(실측: 전체 path 데이터 약 58% 감소)
"""

SCALE = 10          # 0.1 단위를 정수로


def q(v):
    """좌표 → 정수 격자"""
    return int(round(v * SCALE))


def path_d(rings, tr):
    """링 목록 → 압축된 path d 문자열. tr(x, y) -> (px, py) 투영 함수."""
    parts = []
    for ring in rings:
        pts = []
        for x, y in ring:
            px, py = tr(x, y)
            p = (q(px), q(py))
            if not pts or p != pts[-1]:      # 연속 중복점 제거
                pts.append(p)
        if len(pts) < 3:
            continue
        head = f"M{pts[0][0]} {pts[0][1]}"
        prev = pts[0]
        rel = []
        for p in pts[1:]:
            rel.append(f"{p[0] - prev[0]} {p[1] - prev[1]}")
            prev = p
        parts.append(head + "l" + ",".join(rel) + "Z")
    return "".join(parts)


def bbox_of(ring, tr):
    """투영 후 bbox (정수 격자 기준) → (x, y, w, h)"""
    xs, ys = [], []
    for x, y in ring:
        px, py = tr(x, y)
        xs.append(q(px))
        ys.append(q(py))
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)
