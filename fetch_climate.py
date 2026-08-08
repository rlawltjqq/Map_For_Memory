# -*- coding: utf-8 -*-
"""지역별 월평균 기온·강수량(평년값)을 받아 climate.json으로 저장.

Open-Meteo 과거 재분석 자료(ERA5)를 여러 지점씩 묶어 한 번에 요청한다.
빌드할 때 한 번만 돌리면 되고, 앱 실행 중에는 외부 호출이 없다.
"""
import json
import sys
import time
import urllib.parse
import urllib.request

START, END = "2020-01-01", "2024-12-31"
BATCH = 5                       # 한 요청에 넣을 지점 수 (크면 요청 제한에 걸린다)
API = "https://archive-api.open-meteo.com/v1/archive"


def load_points():
    pts = {}
    with open("korea_coords.json", encoding="utf-8") as f:
        pts.update(json.load(f))
    with open("japan_meta.json", encoding="utf-8") as f:
        pts.update(json.load(f)["coords"])
    return pts


def fetch(batch):
    """[(code, lon, lat), ...] -> {code: [[기온, 강수], x12]}"""
    qs = urllib.parse.urlencode({
        "latitude": ",".join(f"{lat}" for _, _, lat in batch),
        "longitude": ",".join(f"{lon}" for _, lon, _ in batch),
        "start_date": START, "end_date": END,
        "daily": "temperature_2m_mean,precipitation_sum",
        "timezone": "UTC",
    })
    with urllib.request.urlopen(f"{API}?{qs}", timeout=180) as r:
        data = json.load(r)
    if isinstance(data, dict):
        data = [data]           # 지점이 하나면 배열이 아니라 객체로 온다
    out = {}
    for (code, _, _), loc in zip(batch, data):
        d = loc["daily"]
        # 월별로 모아 평균 기온과 '월 강수량 평균'을 낸다
        temp = [[] for _ in range(12)]
        rain = [[0.0, 0] for _ in range(12)]   # [합계, 연-월 개수용]
        seen = set()
        for day, t, p in zip(d["time"], d["temperature_2m_mean"], d["precipitation_sum"]):
            m = int(day[5:7]) - 1
            if t is not None:
                temp[m].append(t)
            if p is not None:
                rain[m][0] += p
            seen.add(day[:7])
        months = {}
        for ym in seen:
            months.setdefault(int(ym[5:7]) - 1, 0)
            months[int(ym[5:7]) - 1] += 1
        vals = []
        for m in range(12):
            t = round(sum(temp[m]) / len(temp[m]), 1) if temp[m] else None
            n = months.get(m, 0)
            p = round(rain[m][0] / n) if n else None
            vals.append([t, p])
        out[code] = vals
    return out


def main():
    pts = load_points()
    try:
        with open("climate.json", encoding="utf-8") as f:
            result = json.load(f)          # 중단됐다면 이어서
    except FileNotFoundError:
        result = {}
    todo = [(c, lon, lat) for c, (lon, lat) in pts.items() if c not in result]
    print(f"전체 {len(pts)}곳 / 받아올 곳 {len(todo)}곳")
    for i in range(0, len(todo), BATCH):
        batch = todo[i:i + BATCH]
        for attempt in range(8):
            try:
                result.update(fetch(batch))
                break
            except Exception as e:
                # 429(요청 제한)는 시간당 한도라 넉넉히 쉬어야 풀린다
                limited = "429" in str(e)
                wait = (90 if limited else 10) * (attempt + 1)
                print(f"  재시도 {attempt + 1}/8 ({e}) — {wait}초 대기", file=sys.stderr)
                time.sleep(wait)
        else:
            print(f"  실패: {[c for c, _, _ in batch]}", file=sys.stderr)
        with open("climate.json", "w", encoding="utf-8") as f:
            json.dump(result, f)
        print(f"  {min(i + BATCH, len(todo))}/{len(todo)}")
        time.sleep(6)
    print(f"climate.json 저장 완료 — {len(result)}곳")


if __name__ == "__main__":
    main()
