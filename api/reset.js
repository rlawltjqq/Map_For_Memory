import { redis, hashPw, authRoom, safeEqual } from "./_lib.js";

// 방문 표시 초기화 — 지도 비밀번호 확인 후 실행. country가 있으면 그 나라만.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const { room, password, country } = req.body || {};
  // authRoom이 방 메타를 함께 돌려주므로 hgetall 재조회 불필요 (Redis 왕복 1회 절약)
  const meta = await authRoom(req, room);
  if (!meta) return res.status(403).json({ error: "unauthorized" });
  if (!safeEqual(hashPw(password || "", meta.salt), meta.pwhash))
    return res.status(403).json({ error: "비밀번호가 틀렸습니다" });
  const key = `room:${room}:visited`;
  if (country === "kr" || country === "jp") {
    // 해당 나라 코드만 제거 (일본 코드는 "9"로 시작)
    const all = (await redis.smembers(key)) || [];
    const remove = all.filter((c) => (country === "jp") === String(c).startsWith("9"));
    if (remove.length) await redis.srem(key, ...remove);
  } else {
    await redis.del(key);   // country 없으면 전체
  }
  res.json({ ok: true });
}
