import { redis, authRoom } from "./_lib.js";

// 지역별 방문 메모/날짜 저장:  { date: "2026-07-19", memo: "..." }
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const { room, code, date, memo } = req.body || {};
  if (!(await authRoom(req, room))) return res.status(403).json({ error: "unauthorized" });
  if (!/^\d+$/.test(String(code || ""))) return res.status(400).json({ error: "bad code" });
  const key = `room:${room}:notes`;
  const d = typeof date === "string" ? date.slice(0, 10) : "";
  const m = typeof memo === "string" ? memo.slice(0, 500) : "";
  if (!d && !m) {
    await redis.hdel(key, String(code));
  } else {
    await redis.hset(key, { [String(code)]: { date: d, memo: m } });
  }
  res.json({ ok: true });
}
