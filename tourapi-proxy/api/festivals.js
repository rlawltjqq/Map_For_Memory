// TourAPI(data.go.kr) 중계 — 서울 리전에서만 돈다.
//
// data.go.kr은 해외 IP에서 연결이 자주 끊긴다. GitHub 러너는 전부 해외라
// 축제 갱신 워크플로가 절반 넘게 실패했다. 이 함수는 국내(icn1)에서 나가므로
// 안정적이다. 본 앱은 Redis가 미국에 있어 리전을 못 옮기므로 프록시만 분리했다.
const HOSTS = [
  ["https://apis.data.go.kr/B551011/KorService2", "searchFestival2"],
  ["https://apis.data.go.kr/B551011/KorService1", "searchFestival1"],
];

export default async function handler(req, res) {
  // 아무나 우리 인증키로 조회하지 못하게 공유 비밀로 막는다
  const secret = process.env.PROXY_SECRET;
  if (!secret || req.headers["x-proxy-secret"] !== secret)
    return res.status(403).json({ error: "unauthorized" });

  const key = process.env.TOUR_API_KEY;
  if (!key) return res.status(500).json({ error: "TOUR_API_KEY 미설정" });

  const { start, page = "1", rows = "100" } = req.query;
  if (!/^\d{8}$/.test(start || "")) return res.status(400).json({ error: "bad start" });
  if (!/^\d{1,4}$/.test(page) || !/^\d{1,3}$/.test(rows))
    return res.status(400).json({ error: "bad paging" });

  // 인증키는 이미 %가 든 인코딩 형태로 오는 경우와 원본(+, /, = 포함)인 경우가
  // 모두 있다. 원본이면 인코딩하고, 이미 인코딩돼 있으면 그대로 둔다.
  const encoded = /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
  const qs = `serviceKey=${encoded}&MobileOS=ETC&MobileApp=MapForMemory&_type=json` +
             `&eventStartDate=${start}&numOfRows=${rows}&pageNo=${page}&arrange=A`;

  let lastErr = null;
  for (const [base, op] of HOSTS) {
    try {
      const r = await fetch(`${base}/${op}?${qs}`, { signal: AbortSignal.timeout(25000) });
      const text = await r.text();
      if (text.trimStart().startsWith("<")) {       // 오류는 XML로 온다
        lastErr = text.slice(0, 200);
        continue;
      }
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.status(200).send(text);
    } catch (e) {
      lastErr = String(e);
    }
  }
  res.status(502).json({ error: "TourAPI 호출 실패", detail: lastErr });
}
