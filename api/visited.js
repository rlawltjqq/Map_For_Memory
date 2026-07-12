import { redis, authRoom } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const { room, code, on, codes } = req.body || {};
  if (!(await authRoom(req, room))) return res.status(403).json({ error: "unauthorized" });
  const key = `room:${room}:visited`;

  if (Array.isArray(codes)) {
    // 전체 교체 (가져오기/초기화)
    if (!codes.every((c) => /^\d+$/.test(String(c))))
      return res.status(400).json({ error: "bad codes" });
    await redis.del(key);
    if (codes.length) await redis.sadd(key, ...codes.map(String));
  } else if (/^\d+$/.test(String(code))) {
    // 개별 토글 (원자적이라 동시 편집에 안전)
    if (on) await redis.sadd(key, String(code));
    else await redis.srem(key, String(code));
  } else {
    return res.status(400).json({ error: "bad request" });
  }
  res.json({ ok: true });
}
