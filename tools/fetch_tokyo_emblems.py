# -*- coding: utf-8 -*-
"""도쿄 시·구 문장 수집 → emblems/{코드}.png + emblems.json 갱신

fetch_japan_emblems.py 의 함수를 재사용한다. 동명 지역이 많아
'{이름} (도쿄도)' 같은 후보 제목까지 시도한다.
"""
import json
import os
import re
import time

from fetch_japan_emblems import (FILE_RE, export_wikitexts, http_get, process,
                                 thumb_url, OUT_DIR)

with open("japan_meta.json", encoding="utf-8") as f:
    meta = json.load(f)
targets = {c: meta["names"][c] for c, g in meta["groups"].items() if g == "9T"}
print(f"대상 {len(targets)}곳")


def candidates(name):
    return [f"{name} (도쿄도)", name, f"도쿄도 {name}"]


# 후보 제목을 라운드별로 조회
picked, pending = {}, {c: candidates(n) for c, n in targets.items()}
for rnd in range(3):
    ask = {c: q[rnd] for c, q in pending.items() if c not in picked and rnd < len(q)}
    if not ask:
        break
    texts = export_wikitexts(list(set(ask.values())))
    for code, title in ask.items():
        wt = texts.get(title, "")
        if not wt or re.match(r"\s*#(넘겨주기|redirect)", wt, re.I):
            continue
        for key in ("문장", "휘장", "기"):
            m = FILE_RE[key].search(wt)
            if m:
                fn = m.group(1).strip().replace("_", " ")
                if re.search(r"\.(svg|png|jpe?g|gif)$", fn, re.I):
                    picked[code] = fn
                    break
    print(f"라운드 {rnd + 1}: 누적 {len(picked)}/{len(targets)}")

missing = [targets[c] for c in targets if c not in picked]
if missing:
    print("미확보:", ", ".join(missing))

with open("emblems.json", encoding="utf-8") as f:
    emblems = json.load(f)

ok, fail = 0, []
for i, (code, fn) in enumerate(sorted(picked.items())):
    out_path = os.path.join(OUT_DIR, f"{code}.png")
    if os.path.exists(out_path):
        emblems[code] = f"emblems/{code}.png"
        ok += 1
        continue
    try:
        url = thumb_url(fn)
        if not url:
            fail.append((code, "no thumb"))
            continue
        process(http_get(url)).save(out_path)
        emblems[code] = f"emblems/{code}.png"
        ok += 1
    except Exception as e:
        fail.append((code, str(e)[:40]))
    time.sleep(1.2)
    if (i + 1) % 15 == 0:
        print(f"{i + 1}/{len(picked)} (성공 {ok})")

with open("emblems.json", "w", encoding="utf-8") as f:
    json.dump(emblems, f, ensure_ascii=False, indent=1)
print(f"완료: {ok}/{len(targets)}")
if fail:
    print("실패:", fail[:10])
