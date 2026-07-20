# -*- coding: utf-8 -*-
"""나의 여행 지도 — 로컬 개발 서버.

Vercel 배포판(api/*.js)과 동일한 API를 제공해서, 배포 전에 로컬에서
똑같이 테스트할 수 있다. 데이터는 data/ 폴더에 저장된다.

실행:  python server.py   →  http://localhost:8931
의존성 없음 (파이썬 내장 라이브러리만 사용)
"""
import hashlib
import json
import os
import re
import secrets
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

PORT = 8931
ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
PHOTO_DIR = os.path.join(DATA_DIR, "photos")
ROOMS_FILE = os.path.join(DATA_DIR, "rooms.json")
MAX_PHOTO_BYTES = 8 * 1024 * 1024
ID_ALPHA = "abcdefghjkmnpqrstuvwxyz23456789"

os.makedirs(PHOTO_DIR, exist_ok=True)
_lock = threading.Lock()


def load_rooms():
    if os.path.exists(ROOMS_FILE):
        with open(ROOMS_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_rooms(rooms):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = ROOMS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rooms, f, ensure_ascii=False, indent=1)
    os.replace(tmp, ROOMS_FILE)


def hash_pw(pw, salt):
    # api/_lib.js 의 scryptSync 와 동일한 파라미터
    return hashlib.scrypt(pw.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=32).hex()


def token_of(room_id, pwhash):
    return hashlib.sha256(f"{room_id}:{pwhash}".encode()).hexdigest()


def safe_name(name):
    name = os.path.basename(unquote(name))
    name = re.sub(r"[^\w.\-가-힣 ]", "_", name).strip() or "photo.jpg"
    return name[-80:]


class Handler(SimpleHTTPRequestHandler):
    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_body_bytes(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_PHOTO_BYTES:
            return None
        data = b""
        while len(data) < length:
            chunk = self.rfile.read(min(length - len(data), 1 << 20))
            if not chunk:
                break
            data += chunk
        return data

    def read_json(self):
        try:
            return json.loads(self.read_body_bytes() or b"{}")
        except Exception:
            return {}

    def auth(self, rooms, room_id):
        if not re.fullmatch(r"[a-z0-9]{6,12}", room_id or ""):
            return None
        meta = rooms.get(room_id)
        if not meta:
            return None
        token = self.headers.get("x-token", "")
        return meta if token == token_of(room_id, meta["pwhash"]) else None

    # ---------- GET ----------
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/state":
            q = parse_qs(url.query)
            room_id = (q.get("room") or [""])[0]
            with _lock:
                rooms = load_rooms()
                meta = self.auth(rooms, room_id)
                if not meta:
                    self.send_json({"error": "unauthorized"}, 403)
                    return
                self.send_json({"name": meta["name"],
                                "visited": meta.get("visited", []),
                                "photos": meta.get("photos", {}),
                                "notes": meta.get("notes", {})})
            return
        super().do_GET()

    # ---------- POST ----------
    def do_POST(self):
        url = urlparse(self.path)

        if url.path == "/api/rooms":
            body = self.read_json()
            name = body.get("name") or ""
            password = body.get("password") or ""
            if not name or len(name) > 40:
                self.send_json({"error": "지도 이름이 필요합니다"}, 400)
                return
            if len(password) < 4:
                self.send_json({"error": "암호는 4자 이상이어야 합니다"}, 400)
                return
            room_id = "".join(secrets.choice(ID_ALPHA) for _ in range(8))
            salt = secrets.token_hex(8)
            pwhash = hash_pw(password, salt)
            with _lock:
                rooms = load_rooms()
                rooms[room_id] = {"name": name, "salt": salt, "pwhash": pwhash,
                                  "created": int(time.time() * 1000),
                                  "visited": [], "photos": {}, "notes": {}}
                save_rooms(rooms)
            self.send_json({"id": room_id, "name": name, "token": token_of(room_id, pwhash)})
            return

        if url.path == "/api/join":
            body = self.read_json()
            room_id = body.get("room") or ""
            with _lock:
                rooms = load_rooms()
                meta = rooms.get(room_id)
            if not meta:
                self.send_json({"error": "없는 지도입니다"}, 404)
                return
            if hash_pw(body.get("password") or "", meta["salt"]) != meta["pwhash"]:
                self.send_json({"error": "암호가 틀렸습니다"}, 403)
                return
            self.send_json({"token": token_of(room_id, meta["pwhash"]), "name": meta["name"]})
            return

        if url.path == "/api/visited":
            body = self.read_json()
            room_id = body.get("room") or ""
            with _lock:
                rooms = load_rooms()
                meta = self.auth(rooms, room_id)
                if not meta:
                    self.send_json({"error": "unauthorized"}, 403)
                    return
                codes = body.get("codes")
                code = str(body.get("code") or "")
                if isinstance(codes, list):
                    if not all(re.fullmatch(r"\d+", str(c)) for c in codes):
                        self.send_json({"error": "bad codes"}, 400)
                        return
                    meta["visited"] = sorted({str(c) for c in codes})
                elif re.fullmatch(r"\d+", code):
                    s = set(meta.get("visited", []))
                    (s.add if body.get("on") else s.discard)(code)
                    meta["visited"] = sorted(s)
                else:
                    self.send_json({"error": "bad request"}, 400)
                    return
                save_rooms(rooms)
            self.send_json({"ok": True})
            return

        if url.path == "/api/note":
            body = self.read_json()
            room_id = body.get("room") or ""
            code = str(body.get("code") or "")
            with _lock:
                rooms = load_rooms()
                meta = self.auth(rooms, room_id)
                if not meta:
                    self.send_json({"error": "unauthorized"}, 403)
                    return
                if not re.fullmatch(r"\d+", code):
                    self.send_json({"error": "bad code"}, 400)
                    return
                visits = body.get("visits")
                if not isinstance(visits, list):
                    self.send_json({"error": "bad visits"}, 400)
                    return
                def _date(s):
                    return s if isinstance(s, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", s) else ""
                clean = []
                for v in visits[:50]:
                    if not isinstance(v, dict):
                        continue
                    item = {"start": _date(v.get("start")), "end": _date(v.get("end")),
                            "memo": (v.get("memo") or "")[:500] if isinstance(v.get("memo"), str) else ""}
                    if item["start"] or item["end"] or item["memo"]:
                        clean.append(item)
                notes = meta.setdefault("notes", {})
                if not clean:
                    notes.pop(code, None)
                else:
                    notes[code] = {"visits": clean}
                save_rooms(rooms)
            self.send_json({"ok": True})
            return

        if url.path == "/api/photo":
            q = parse_qs(url.query)
            room_id = (q.get("room") or [""])[0]
            code = (q.get("code") or [""])[0]
            if not re.fullmatch(r"\d+", code):
                self.send_json({"error": "bad code"}, 400)
                return
            data = self.read_body_bytes()
            with _lock:
                rooms = load_rooms()
                meta = self.auth(rooms, room_id)
                if not meta:
                    self.send_json({"error": "unauthorized"}, 403)
                    return
                if not data:
                    self.send_json({"error": "empty body"}, 400)
                    return
                name = safe_name(self.headers.get("X-Filename", "photo.jpg"))
                fname = f"{int(time.time() * 1000)}_{name}"
                folder = os.path.join(PHOTO_DIR, room_id, code)
                os.makedirs(folder, exist_ok=True)
                with open(os.path.join(folder, fname), "wb") as f:
                    f.write(data)
                url_path = f"/data/photos/{room_id}/{code}/{fname}"
                meta.setdefault("photos", {}).setdefault(code, []).append(
                    {"url": url_path, "name": name})
                save_rooms(rooms)
            self.send_json({"ok": True, "url": url_path, "name": name})
            return

        self.send_json({"error": "not found"}, 404)

    # ---------- DELETE ----------
    def do_DELETE(self):
        url = urlparse(self.path)
        if url.path != "/api/photo":
            self.send_json({"error": "not found"}, 404)
            return
        q = parse_qs(url.query)
        room_id = (q.get("room") or [""])[0]
        code = (q.get("code") or [""])[0]
        target = self.read_json().get("url") or ""
        with _lock:
            rooms = load_rooms()
            meta = self.auth(rooms, room_id)
            if not meta:
                self.send_json({"error": "unauthorized"}, 403)
                return
            files = meta.get("photos", {}).get(code, [])
            item = next((p for p in files if p["url"] == target), None)
            if item:
                files.remove(item)
                if not files:
                    del meta["photos"][code]
                save_rooms(rooms)
                # url → 실제 파일 경로 (data/photos 아래만 허용)
                rel = os.path.normpath(unquote(target).lstrip("/"))
                path = os.path.join(ROOT, rel)
                if path.startswith(PHOTO_DIR) and os.path.exists(path):
                    os.remove(path)
        self.send_json({"ok": True})

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Handler, directory=ROOT))
    print(f"나의 여행 지도: http://localhost:{PORT}")
    print(f"데이터 저장 위치: {DATA_DIR}")
    server.serve_forever()
