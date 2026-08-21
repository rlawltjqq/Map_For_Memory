# -*- coding: utf-8 -*-
"""한국관광공사 TourAPI에서 축제 사진과 실제 일정을 받아온다.

위키백과·커먼즈로는 64건 중 29건밖에 못 채웠다. TourAPI는 전국 축제를
사진과 함께 제공하므로 커버리지가 훨씬 높다.

준비:
  1) https://www.data.go.kr 회원가입 후 '한국관광공사_국문 관광정보 서비스' 활용신청
  2) 발급받은 일반 인증키(Decoding)를 환경변수나 .env.local에 넣는다
       TOUR_API_KEY=발급받은키
  3) python fetch_tourapi_photos.py

결과: tourapi_festivals.json (축제명 -> 사진주소·기간), 이어서
      download_festival_photos.py가 내려받을 수 있게 festival_photos.json에 합친다.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

# 2025년에 KorService1 -> KorService2로 옮겨갔다. 둘 다 시도한다.
HOSTS = [
    ("https://apis.data.go.kr/B551011/KorService2", "searchFestival2"),
    ("https://apis.data.go.kr/B551011/KorService1", "searchFestival1"),
]
UA = {"User-Agent": "MapForMemory/1.0"}


def env(name):
    v = os.environ.get(name)
    if v:
        return v.strip()
    try:
        with open(".env.local", encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith(name + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return None


def load_key():
    return env("TOUR_API_KEY")


def fetch_page(base, op, key, start_date, page, rows=100):
    qs = urllib.parse.urlencode({
        "serviceKey": key, "MobileOS": "ETC", "MobileApp": "MapForMemory",
        "_type": "json", "eventStartDate": start_date,
        "numOfRows": rows, "pageNo": page, "arrange": "A",
    }, safe="%")           # 인증키에 이미 %가 들어있을 수 있어 다시 인코딩하지 않는다

    # data.go.kr은 해외 IP에서 연결이 자주 끊긴다(GitHub 러너에서 절반 넘게 실패).
    # 서울 리전 프록시가 설정돼 있으면 그쪽을 거쳐 국내에서 나가게 한다.
    proxy, secret = env("TOUR_PROXY_URL"), env("TOUR_PROXY_SECRET")
    if proxy and secret:
        purl = f"{proxy}?start={start_date}&page={page}&rows={rows}"
        req = urllib.request.Request(purl, headers={**UA, "x-proxy-secret": secret})
    else:
        req = urllib.request.Request(f"{base}/{op}?{qs}", headers=UA)
    # data.go.kr은 해외(GitHub 러너)에서 연결 자체가 자주 끊긴다. 간헐적이라
    # 오래 붙들고 여러 번 시도하면 대개 뚫린다. 연 1회 작업이라 기다려도 된다.
    last = None
    for attempt in range(8):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read().decode("utf-8", "replace")
            break
        except Exception as e:
            last = e
            if attempt < 7:
                wait = min(60, 10 * (attempt + 1))
                print(f"    연결 재시도 {attempt + 1}/8 ({wait}초 대기)")
                time.sleep(wait)
    else:
        raise RuntimeError(f"연결 실패: {last}")
    if raw.lstrip().startswith("<"):        # 오류는 XML로 온다
        msg = re.search(r"<returnAuthMsg>([^<]*)", raw) or re.search(r"<errMsg>([^<]*)", raw)
        raise RuntimeError(f"API 오류: {msg.group(1) if msg else raw[:160]}")
    body = json.loads(raw).get("response", {}).get("body", {})
    items = body.get("items") or {}
    got = items.get("item") if isinstance(items, dict) else None
    return (got or []), int(body.get("totalCount") or 0)


def fetch_all(key, start_date):
    # 프록시를 쓰면 엔드포인트 선택은 프록시가 하므로 한 번만 돈다
    hosts = HOSTS[:1] if (env("TOUR_PROXY_URL") and env("TOUR_PROXY_SECRET")) else HOSTS
    last_err = None
    for base, op in hosts:
        try:
            first, total = fetch_page(base, op, key, start_date, 1)
            out = list(first)
            pages = (total + 99) // 100
            for p in range(2, pages + 1):
                items, _ = fetch_page(base, op, key, start_date, p)
                out += items
                print(f"  {len(out)}/{total}")
                time.sleep(0.3)
            print(f"{op}: {len(out)}건 수신")
            return out
        except Exception as e:
            last_err = e
            print(f"  {op} 실패: {e}")
    raise SystemExit(f"TourAPI 호출 실패: {last_err}")


def norm(s):
    """비교용 정규화 — 공백·괄호·'제N회' 같은 수식어 제거"""
    s = re.sub(r"제?\s*\d+\s*회", "", s or "")
    s = re.sub(r"[\s()\[\]{}<>·,~\-—]", "", s)
    return s


def core_tokens(name):
    """축제명에서 특징적인 조각 (지역명 + 핵심어)"""
    n = norm(name)
    return [t for t in re.split(r"(축제|페스티벌|제)", n) if len(t) >= 2]


def match(fes_name, api_titles, region="", alias=""):
    """우리 축제명 <-> TourAPI 축제명. 한쪽이 다른 쪽을 품으면 채택."""
    # 공식 명칭이 우리 표기와 아주 다른 축제는 별칭으로 바로 찾는다
    # (광주 세계김치축제 -> 광주김치축제)
    if alias:
        for t, item in api_titles:
            if t == alias:
                return t, item
    a = norm(fes_name)
    best = None
    for t, item in api_titles:
        b = norm(t)
        if a and b and (a in b or b in a):
            score = min(len(a), len(b)) / max(len(a), len(b))
            if not best or score > best[0]:
                best = (score, t, item)
    if best:
        return best[1], best[2]
    # 부분 일치는 지역명이 함께 있을 때만 인정한다.
    # '인제 빙어축제'는 '제'가 잘려나가 '빙어축제'만 남는 바람에
    # 안성 동막골 빙어축제에 붙은 적이 있다.
    place = re.sub(r"(특별자치)?(시|군|구|도)$", "", region or "")
    if not place or len(place) < 2:
        return None, None
    toks = [t for t in core_tokens(fes_name) if t not in ("축제", "페스티벌")]
    if not toks:
        return None, None
    for t, item in api_titles:
        b = norm(t)
        if place in b and all(tok in b for tok in toks):
            return t, item
    return None, None


def main():
    key = load_key()
    if not key:
        raise SystemExit(
            "TOUR_API_KEY가 없습니다.\n"
            "  1) https://www.data.go.kr 에서 '한국관광공사_국문 관광정보 서비스' 활용신청\n"
            "  2) 일반 인증키(Decoding)를 .env.local에 TOUR_API_KEY=키 로 저장\n"
            "  3) 다시 실행")

    year = time.localtime().tm_year
    items = []
    for y in (year, year - 1):        # 올해에 아직 안 올라온 축제는 작년 자료로 채운다
        print(f"{y}년 축제 조회…")
        items += fetch_all(key, f"{y}0101")

    api_titles = [(it.get("title", ""), it) for it in items if it.get("title")]
    print(f"TourAPI 축제 {len(api_titles)}건")

    with open("festivals.json", encoding="utf-8") as f:
        fes_raw = json.load(f)
    try:
        with open("festival_photos.json", encoding="utf-8") as f:
            photos = json.load(f)
    except FileNotFoundError:
        photos = {}

    out, added = {}, 0
    for fes in fes_raw.get("kr", []):
        name = fes["name"]
        title, item = match(name, api_titles, fes.get("region", ""), fes.get("tour", ""))
        if not item:
            continue
        img = item.get("firstimage") or item.get("firstimage2")
        rec = {"apiTitle": title, "image": img,
               "start": item.get("eventstartdate"), "end": item.get("eventenddate"),
               "addr": item.get("addr1")}
        out[name] = rec
        if img and not photos.get(name, {}).get("url"):
            photos[name] = {"region": fes["region"], "lang": "ko",
                            "page": f"TourAPI:{title}", "file": os.path.basename(
                                urllib.parse.urlparse(img).path),
                            "url": img, "author": "한국관광공사",
                            "license": "공공누리 (출처표시)"}
            added += 1

    with open("tourapi_festivals.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    with open("festival_photos.json", "w", encoding="utf-8") as f:
        json.dump(photos, f, ensure_ascii=False, indent=1)

    matched = len(out)
    withimg = sum(1 for v in out.values() if v.get("image"))
    total = len(fes_raw.get("kr", []))
    have = sum(1 for v in photos.values() if v.get("url"))
    print(f"\n매칭 {matched}/{total}건, 그중 사진 있는 것 {withimg}건")
    print(f"새로 채운 사진 {added}건 -> 전체 사진 {have}건")
    print("다음: python download_festival_photos.py && python build_page.py")


if __name__ == "__main__":
    main()
