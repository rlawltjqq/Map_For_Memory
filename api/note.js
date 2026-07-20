import { redis, authRoom } from "./_lib.js";

// 지역별 방문 기록: { visits: [ { start:"2026-07-15", end:"2026-07-16", memo:"..." }, ... ] }
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const { room, code, visits } = req.body || {};
  if (!(await authRoom(req, room))) return res.status(403).json({ error: "unauthorized" });
  if (!/^\d+$/.test(String(code || ""))) return res.status(400).json({ error: "bad code" });
  if (!Array.isArray(visits)) return res.status(400).json({ error: "bad visits" });

  const clean = visits.slice(0, 50).map((v) => ({
    id: typeof (v && v.id) === "string" && /^[\w-]{1,40}$/.test(v.id) ? v.id : "",
    start: isDate(v && v.start) ? v.start : "",
    end: isDate(v && v.end) ? v.end : "",
    memo: typeof (v && v.memo) === "string" ? v.memo.slice(0, 500) : "",
  })).filter((v) => v.id || v.start || v.end || v.memo);

  const key = `room:${room}:notes`;
  if (clean.length === 0) await redis.hdel(key, String(code));
  else await redis.hset(key, { [String(code)]: { visits: clean } });
  res.json({ ok: true });
}
