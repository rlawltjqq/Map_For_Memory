// 오프라인 지원 — 앱 껍데기(HTML/아이콘/심벌)는 캐시, 데이터(API)는 항상 네트워크
const VERSION = "v4";
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll([
      "/", "/index.html", "/manifest.webmanifest",
      "/icons/icon-192.png", "/icons/apple-touch-icon.png",
    ])).then(() => self.skipWaiting()).catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                 // 쓰기는 건드리지 않음
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return;      // 데이터는 항상 네트워크

  // 지자체 심벌·아이콘 등 정적 이미지: 캐시 우선 (오프라인에서도 표시)
  if (url.origin === location.origin &&
      /^\/(emblems|icons)\//.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // 문서(HTML): 네트워크 우선 + 실패 시 캐시 (오프라인에서도 앱이 열림)
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put("/index.html", copy));
        return res;
      }).catch(() => caches.match("/index.html").then((hit) => hit || caches.match("/")))
    );
    return;
  }

  // 그 외 동일 출처 정적 파일(app.js, 지도 SVG, 축제 사진 등): 캐시 우선 + 캐시에 저장.
  // 저장하지 않으면 캐시에 들어갈 일이 없어 매번 네트워크에서 받게 된다.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
