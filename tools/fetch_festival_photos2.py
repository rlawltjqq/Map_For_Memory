# -*- coding: utf-8 -*-
"""1차(위키백과 대표 이미지)에서 못 찾은 축제를 위키미디어 커먼즈에서 보충한다.

위키백과 문서가 없어도 커먼즈에는 사진이 있는 축제가 많다.
다만 검색 결과에 '축제 무대에 선 아이돌' 팬 촬영 사진이 섞인다
(예: 160730 러블리즈 봉화은어축제). 축제 자체를 보여주지 못하므로 걸러낸다.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "MapForMemory/1.0 (travel map hobby project)"}

# 날짜로 시작하는 파일명(160730 …)은 대개 공연 팬 사진.
# 인물 위주 사진도 축제 분위기를 못 보여줘 제외한다.
BAD_TITLE = re.compile(r"^\d{6}[ _]|logo|poster|symbol|portrait|cosplay", re.I)


def api(host, params):
    url = f"https://{host}/w/api.php?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=UA)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r)
        except Exception:
            time.sleep(8 * (attempt + 1))
    return {}


def search_files(query, limit=8):
    d = api("commons.wikimedia.org", {
        "action": "query", "list": "search", "srsearch": query,
        "srnamespace": 6, "srlimit": limit, "format": "json"})
    return [h["title"].replace("File:", "")
            for h in d.get("query", {}).get("search", [])]


def file_info(fname):
    d = api("commons.wikimedia.org", {
        "action": "query", "prop": "imageinfo", "iiprop": "url|extmetadata",
        "titles": f"File:{fname}", "format": "json"})
    for p in d.get("query", {}).get("pages", {}).values():
        info = (p.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})
        def get(k):
            return re.sub(r"<[^>]+>", "", meta.get(k, {}).get("value", "")).strip()
        return {"url": info.get("url"), "author": get("Artist")[:80],
                "license": get("LicenseShortName")[:40]}
    return {}


def main():
    with open("festivals.json", encoding="utf-8") as f:
        raw = json.load(f)
    with open("festival_photos.json", encoding="utf-8") as f:
        out = json.load(f)

    todo = [fes for c in ("kr", "jp") for fes in raw.get(c, [])
            if not out.get(fes["name"], {}).get("url")]
    print(f"보충 대상 {len(todo)}건")
    for fes in todo:
        name = fes["name"]
        if out.get(name, {}).get("tried2"):
            continue
        picked = None
        for q in (name.replace(" ", ""), name):
            for title in search_files(q):
                if BAD_TITLE.search(title):
                    continue
                info = file_info(title)
                if info.get("url"):
                    picked = (title, info)
                    break
            if picked:
                break
            time.sleep(0.5)
        rec = out.setdefault(name, {"region": fes["region"], "lang": "ko"})
        rec["tried2"] = True
        if picked:
            title, info = picked
            rec.update({"page": "commons:" + title, "file": title,
                        "url": info["url"], "author": info["author"],
                        "license": info["license"]})
        line = f"  {'O' if picked else '-'} {name} <- {picked[0] if picked else ''}"
        enc = sys.stdout.encoding or "utf-8"
        print(line.encode(enc, "replace").decode(enc, "replace"))
        with open("festival_photos.json", "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        time.sleep(1.0)
    have = sum(1 for v in out.values() if v.get("url"))
    print(f"사진 {have}/{len(out)}건")


if __name__ == "__main__":
    main()
