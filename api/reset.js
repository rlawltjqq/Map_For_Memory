import { redis, hashPw, authRoom } from "./_lib.js";

// 전체 초기화 — 지도 비밀번호를 서버에서 확인한 뒤에만 실행
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const { room, password } = req.body || {};
  if (!(await authRoom(req, room))) return res.status(403).json({ error: "unauthorized" });
  const meta = await redis.hgetall(`room:${room}`);
  if (!meta || !meta.pwhash) return res.status(404).json({ error: "없는 지도입니다" });
  if (hashPw(password || "", meta.salt) !== meta.pwhash)
    return res.status(403).json({ error: "비밀번호가 틀렸습니다" });
  await redis.del(`room:${room}:visited`);
  res.json({ ok: true });
}
