# -*- coding: utf-8 -*-
"""시·군·구별 공식 휘장(심벌마크) 이미지 URL 수집 → emblems.json

ko.wikipedia export API(한 번에 40개 문서 전문)로 각 지자체 문서를 받아
인포박스의 휘장 파일명을 찾고, 위키미디어 썸네일 URL로 변환한다.
(지자체 휘장은 공공저작물 자유이용 대상)
"""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter

API = "https://ko.wikipedia.org/w/api.php"
HEADERS = {"User-Agent": "MapForMemory/1.0 (personal hobby project)"}
EMBLEM_RE = re.compile(r"\|\s*(?:휘장|시휘장|군휘장|구휘장|심벌|심볼|로고)\s*=\s*([^\n|]+)")
FLAG_RE = re.compile(r"\|\s*(?:기|시기|군기|구기|깃발)\s*=\s*([^\n|]+)")
REDIRECT_RE = re.compile(r"#(?:넘겨주기|redirect)\s*\[\[([^\]|#]+)", re.I)
BATCH = 10   # export 응답이 커지면 뒷부분 문서가 잘려 나오므로 작게 유지


def http_get(url, retries=6):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            return urllib.request.urlopen(req, timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                time.sleep(4 * (attempt + 1))
                continue
            raise
    return b""


def api_json(params):
    params = dict(params, format="json", formatversion=2)
    return json.loads(http_get(API + "?" + urllib.parse.urlencode(params)))


def export_wikitexts(titles):
    """titles -> {문서제목: 위키텍스트}. 제목은 위키 정규화 형태로 반환됨."""
    out = {}
    for i in range(0, len(titles), BATCH):
        chunk = titles[i:i + BATCH]
        params = urllib.parse.urlencode({
            "action": "query", "export": 1, "exportnowrap": 1,
            "titles": "|".join(chunk), "format": "json"})
        xml_bytes = http_get(API + "?" + params)
        root = ET.fromstring(xml_bytes)
        for page in root.iter():
            if not page.tag.endswith("}page"):
                continue
            title = text = None
            for el in page.iter():
                tag = el.tag.split("}")[-1]
                if tag == "title":
                    title = el.text
                elif tag == "text":
                    text = el.text
            if title:
                out[title] = text or ""
        time.sleep(0.6)
    # 응답 크기 제한으로 누락된 문서는 개별 재요청
    missing = [t for t in titles if t not in out]
    for t in missing:
        params = urllib.parse.urlencode({
            "action": "query", "export": 1, "exportnowrap": 1, "titles": t})
        try:
            root = ET.fromstring(http_get(API + "?" + params))
        except Exception:
            continue
        for el in root.iter():
            if el.tag.endswith("}text") and el.text:
                out[t] = el.text
        time.sleep(0.4)
    return out


with open("korea_municipalities.geojson", encoding="utf-8") as f:
    munis = [f_["properties"] for f_ in json.load(f)["features"]]
with open("korea_provinces.geojson", encoding="utf-8") as f:
    prov_full = {p["properties"]["code"]: p["properties"]["name"]
                 for p in json.load(f)["features"]}

name_counts = Counter(m["name"] for m in munis)
MANUAL = {"세종시": ["세종특별자치시"]}


def candidates(m):
    n, prov = m["name"], prov_full.get(m["code"][:2], "")
    if n in MANUAL:
        return list(MANUAL[n])
    mm = re.match(r"^(.+?시)(.+구)$", n)   # 전주시완산구 → 완산구 (전주시)
    if mm:
        city, gu = mm.group(1), mm.group(2)
        return [f"{gu} ({city})", gu, n]
    if name_counts[n] > 1:
        return [f"{n} ({prov})", n]
    return [n, f"{n} ({prov})"]


def clean_filename(raw):
    f = raw.strip().strip("[]").replace("파일:", "").replace("File:", "").strip()
    return f if f and re.search(r"\.(svg|png|jpe?g|gif)$", f, re.I) else None


def find_emblem_file(wt):
    """휘장 계열 우선, 없으면 깃발 계열. 유효한 이미지 파일명이 나올 때까지 훑는다."""
    for rx in (EMBLEM_RE, FLAG_RE):
        for m in rx.finditer(wt):
            fn = clean_filename(m.group(1))
            if fn:
                return fn
    return None


# 각 코드마다 후보 제목 큐를 두고, 라운드마다 배치 조회.
# 넘겨주기(redirect) 문서를 만나면 대상 문서를 큐 앞에 추가.
queues = {m["code"]: candidates(m) for m in munis}
names = {m["code"]: m["name"] for m in munis}
emblem_files = {}
for round_no in range(6):
    ask = {}
    for code, q in queues.items():
        if code in emblem_files:
            continue
        while q:
            t = q[0]
            ask[code] = t
            break
    if not ask:
        break
    texts = export_wikitexts(list(set(ask.values())))
    for code, title in ask.items():
        queues[code].pop(0)
        wt = texts.get(title, "")
        if not wt:
            continue
        rd = REDIRECT_RE.match(wt.strip())
        if rd:
            queues[code].insert(0, rd.group(1).strip())
            continue
        # 휘장이 최우선, 없으면 지자체기(대부분 흰 바탕 + 심벌이라 동일한 그림)
        fn = find_emblem_file(wt)
        if fn:
            emblem_files[code] = fn
    print(f"라운드 {round_no + 1}: 누적 {len(emblem_files)}/{len(munis)}")

# 일반구(자체 휘장 없음)는 모도시 휘장을 상속
parent_needs = {}
for m in munis:
    if m["code"] in emblem_files:
        continue
    mm = re.match(r"^(.+?시)(.+구)$", m["name"])
    if mm:
        parent_needs.setdefault(mm.group(1), []).append(m["code"])
if parent_needs:
    texts = export_wikitexts(list(parent_needs.keys()))
    for city, codes in parent_needs.items():
        fn = find_emblem_file(texts.get(city, ""))
        if fn:
            for code in codes:
                emblem_files[code] = fn
    print(f"모도시 상속 후: {len(emblem_files)}/{len(munis)}")

# 파일명 → 썸네일 URL (imageinfo, continuation 대응)
def batch_thumb_urls(filenames, width=96):
    uniq = sorted(set(filenames))
    out = {}
    for i in range(0, len(uniq), BATCH):
        chunk = uniq[i:i + BATCH]
        cont = {}
        pages = {}
        norm = {}
        while True:
            d = api_json({"action": "query",
                          "titles": "|".join(f"File:{f}" for f in chunk),
                          "prop": "imageinfo", "iiprop": "url",
                          "iiurlwidth": width, "redirects": 1, **cont})
            q = d.get("query", {})
            for x in q.get("normalized", []):
                norm[x["from"]] = x["to"]
            for p in q.get("pages", []):
                if p.get("imageinfo"):
                    pages[p["title"]] = p["imageinfo"][0]
            if "continue" in d:
                cont = d["continue"]
                time.sleep(0.3)
            else:
                break
        for f in chunk:
            t = norm.get(f"File:{f}", f"File:{f}")
            if t in pages:
                out[f] = pages[t].get("thumburl") or pages[t].get("url")
        time.sleep(0.6)
    return out


urls = batch_thumb_urls(list(emblem_files.values()))
emblems = {code: urls[fn] for code, fn in emblem_files.items() if fn in urls}

with open("emblems.json", "w", encoding="utf-8") as f:
    json.dump(emblems, f, ensure_ascii=False, indent=1)
misses = [names[c] for c in queues if c not in emblems]
print(f"완료: {len(emblems)}/{len(munis)} 확보")
print("미확보:", ", ".join(misses) if misses else "없음")
