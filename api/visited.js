import { redis, authRoom } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const { room, code, on } = req.body || {};
  if (!(await authRoom(req, room))) return res.status(403).json({ error: "unauthorized" });
  const key = `room:${room}:visited`;

  // 전체 교체는 지원하지 않음 — 전체 삭제는 비밀번호가 필요한 /api/reset 으로만
  if (/^\d+$/.test(String(code))) {
    // 개별 토글 (원자적이라 동시 편집에 안전)
    if (on) await redis.sadd(key, String(code));
    else await redis.srem(key, String(code));
  } else {
    return res.status(400).json({ error: "bad request" });
  }
  res.json({ ok: true });
}
