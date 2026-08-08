# -*- coding: utf-8 -*-
"""축제 대표 사진 후보를 위키백과에서 찾아 festival_photos.json으로 저장.

검색 결과가 엉뚱한 문서일 수 있으므로 '어떤 문서에서 가져왔는지'를 함께 남긴다.
사람이 훑어보고 틀린 것을 빼낸 뒤 download_festival_photos.py로 내려받는다.
위키미디어 이미지는 대개 출처 표기가 필요해 저작자·라이선스도 같이 받는다.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "MapForMemory/1.0 (travel map hobby project)"}


def api(host, params):
    url = f"https://{host}/w/api.php?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=UA)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            wait = 20 * (attempt + 1)
            print(f"    요청 제한: {wait}초 대기")
            time.sleep(wait)
    return {}


# 검색이 축제가 아니라 그 지역 문서를 물어오는 일이 잦다(인제 빙어축제 -> 인제군).
# 축제 문서처럼 보이지 않으면 사진을 쓰지 않는다.
FEST_WORDS = ("축제", "제전", "祭", "まつり", "マツリ", "フェス", "페스티벌", "영화제", "음악제")


def looks_like_festival(title, fes_name, region):
    if not title:
        return False
    if title.strip() == region.strip():          # 지역 문서 그대로면 탈락
        return False
    if any(w in title for w in FEST_WORDS):
        return True
    # 축제 이름의 특징적인 낱말을 문서 제목이 품고 있는가
    core = fes_name.replace(region, "").replace(" ", "")
    return len(core) >= 2 and core in title.replace(" ", "")


def search_title(lang, query):
    d = api(f"{lang}.wikipedia.org", {
        "action": "query", "list": "search", "srsearch": query,
        "srlimit": 1, "format": "json"})
    hits = d.get("query", {}).get("search", [])
    return hits[0]["title"] if hits else None


def lead_image(lang, title):
    d = api(f"{lang}.wikipedia.org", {
        "action": "query", "prop": "pageimages", "piprop": "original|name",
        "titles": title, "format": "json"})
    for p in d.get("query", {}).get("pages", {}).values():
        if "original" in p:
            return p["original"]["source"], p.get("pageimage")
    return None, None


def credit(filename):
    """커먼즈 파일의 저작자·라이선스"""
    if not filename:
        return {}
    d = api("commons.wikimedia.org", {
        "action": "query", "prop": "imageinfo", "iiprop": "extmetadata",
        "titles": f"File:{filename}", "format": "json"})
    for p in d.get("query", {}).get("pages", {}).values():
        meta = (p.get("imageinfo") or [{}])[0].get("extmetadata", {})
        def get(k):
            v = meta.get(k, {}).get("value", "")
            return re.sub(r"<[^>]+>", "", v).strip()
        return {"author": get("Artist")[:80], "license": get("LicenseShortName")[:40]}
    return {}


import re

def main():
    with open("festivals.json", encoding="utf-8") as f:
        raw = json.load(f)
    try:
        with open("festival_photos.json", encoding="utf-8") as f:
            out = json.load(f)
    except FileNotFoundError:
        out = {}

    for country, lang in (("kr", "ko"), ("jp", "ja")):
        for fes in raw.get(country, []):
            name = fes["name"]
            if name in out:
                continue
            # 축제 이름 그대로 검색 (띄어쓰기 없는 표기도 함께 시도)
            # 검색은 쓰지 않는다. 없는 축제를 물으면 엉뚱한 축제 문서를 물어오기 때문
            # (보성 다향대축제 -> 함평나비대축제). 정확한 제목만 조회한다.
            url = fname = title = None
            for cand in ([fes["wiki"]] if fes.get("wiki") else [name.replace(" ", ""), name]):
                u, f2 = lead_image(lang, cand)
                if u:
                    url, fname, title = u, f2, cand
                    break
            out[name] = {
                "region": fes["region"], "lang": lang, "page": title,
                "url": url, "file": fname,
                **(credit(fname) if fname else {}),
            }
            mark = "O" if url else "-"
            # 콘솔 인코딩(cp949)이 일본어를 못 찍어 죽는 일이 있어 안전하게 출력
            line = f"  {mark} {name} <- {title}"
            enc = sys.stdout.encoding or "utf-8"
            print(line.encode(enc, "replace").decode(enc, "replace"))
            with open("festival_photos.json", "w", encoding="utf-8") as f:
                json.dump(out, f, ensure_ascii=False, indent=1)
            time.sleep(0.6)
    have = sum(1 for v in out.values() if v.get("url"))
    print(f"사진 후보 {have}/{len(out)}건")


if __name__ == "__main__":
    main()
