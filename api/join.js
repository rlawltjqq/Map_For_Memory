import { redis, hashPw, tokenOf, validRoom } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const { room, password } = req.body || {};
  if (!validRoom(room)) return res.status(404).json({ error: "없는 지도입니다" });
  const meta = await redis.hgetall(`room:${room}`);
  if (!meta || !meta.pwhash) return res.status(404).json({ error: "없는 지도입니다" });
  if (hashPw(password || "", meta.salt) !== meta.pwhash)
    return res.status(403).json({ error: "암호가 틀렸습니다" });
  res.json({ token: tokenOf(room, meta.pwhash), name: meta.name });
}
