# -*- coding: utf-8 -*-
"""festival_photos.json의 사진을 내려받아 작게 줄여 festival_photos/에 저장.

위키미디어는 핫링크를 권장하지 않고, 원본은 수 MB짜리도 있어 그대로 쓰면
페이지가 무거워진다. 썸네일 URL(폭 지정)로 받아 그대로 저장한다.
"""
import json
import os
import re
import time
import urllib.parse
import urllib.request

OUT = "festival_photos"
# 위키미디어는 임의 폭을 거부한다. 320을 요청하면 330px를 주고 20~40KB로 카드에 알맞다.
WIDTHS = (320,)
UA = {"User-Agent": "MapForMemory/1.0 (travel map hobby project)"}


def thumb_url(file_name, width):
    """파일 이름 -> 위키미디어가 인정하는 썸네일 주소.

    주소를 직접 조립하면 크기 제한에 걸려 400이 난다(임의 폭 금지).
    API에 폭을 알려주고 유효한 주소를 받아온다.
    """
    if not file_name:
        return None
    qs = urllib.parse.urlencode({
        "action": "query", "prop": "imageinfo", "iiprop": "url",
        "iiurlwidth": width, "titles": f"File:{file_name}", "format": "json"})
    req = urllib.request.Request("https://commons.wikimedia.org/w/api.php?" + qs, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        d = json.load(r)
    for p in d.get("query", {}).get("pages", {}).values():
        info = (p.get("imageinfo") or [{}])[0]
        return info.get("thumburl") or info.get("url")
    return None


def main():
    os.makedirs(OUT, exist_ok=True)
    with open("festival_photos.json", encoding="utf-8") as f:
        data = json.load(f)
    saved = {}
    for name, info in data.items():
        if not info.get("url"):
            continue
        # 로고·포스터는 축제 분위기를 보여주지 못해 사진 칸에 어울리지 않는다
        if re.search(r"logo|poster|symbol", info.get("file", ""), re.I):
            print(f"  건너뜀(로고) {name}")
            continue
        # 커먼즈에는 동영상·음성도 섞여 있어 이미지가 아니면 카드에 못 쓴다
        if not re.search(r"\.(jpe?g|png|webp)$", info.get("file", ""), re.I):
            print(f"  건너뜀(이미지 아님) {name}")
            continue
        safe = re.sub(r"[^\w가-힣]+", "_", name).strip("_")
        ext = ".png" if info["url"].lower().endswith(".svg") else os.path.splitext(
            urllib.parse.urlparse(info["url"]).path)[1] or ".jpg"
        path = os.path.join(OUT, safe + ext)
        if not os.path.exists(path):
            # TourAPI 사진은 그 주소에서 바로 받는다 (커먼즈 썸네일 규칙이 없다)
            direct = not info.get("url", "").startswith("https://upload.wikimedia.org")
            got = False
            for attempt in range(4):            # 요청 제한에 자주 걸려 재시도가 필요하다
                try:
                    turl = info["url"] if direct else thumb_url(info.get("file"), WIDTHS[0])
                    if not turl:
                        break
                    req = urllib.request.Request(turl, headers=UA)
                    with urllib.request.urlopen(req, timeout=60) as r:
                        body = r.read()
                    with open(path, "wb") as w:
                        w.write(body)
                    got = True
                    break
                except Exception as e:
                    if attempt == 3:
                        print(f"  실패 {name}: {e}")
                    time.sleep(6 * (attempt + 1))
            if not got:
                continue
            time.sleep(1.0)
        saved[name] = {"file": os.path.basename(path),
                       "author": info.get("author", ""), "license": info.get("license", "")}
        print(f"  {name}: {os.path.getsize(path) // 1024}KB")
    with open("festival_photo_index.json", "w", encoding="utf-8") as f:
        json.dump(saved, f, ensure_ascii=False, indent=1)
    total = sum(os.path.getsize(os.path.join(OUT, v["file"])) for v in saved.values())
    print(f"{len(saved)}장 저장, 합계 {total // 1024}KB")


if __name__ == "__main__":
    main()
