import crypto from "node:crypto";
import { del } from "@vercel/blob";
import { redis, hashPw, tokenOf, authRoom, safeEqual } from "./_lib.js";

const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";

export default async function handler(req, res) {
  // 지도 삭제 — 방 비밀번호 확인 후 사진 파일까지 모두 지운다 (되돌릴 수 없음)
  if (req.method === "DELETE") {
    const { room, password } = req.body || {};
    const meta = await authRoom(req, room);
    if (!meta) return res.status(403).json({ error: "unauthorized" });
    if (!safeEqual(hashPw(password || "", meta.salt), meta.pwhash))
      return res.status(403).json({ error: "비밀번호가 틀렸습니다" });
    // 이 방이 직접 올린 사진만 지운다. 백업 복원으로 다른 지도의 사진을 링크만
    // 걸어둔 경우가 있어, 무조건 지우면 원본 지도의 사진까지 날아간다.
    const mine = `/rooms/${room}/`;
    const photos = (await redis.hgetall(`room:${room}:photos`)) || {};
    for (const list of Object.values(photos))
      for (const p of list || []) {
        if (!p || !p.url) continue;
        let own = false;
        try { own = new URL(p.url).pathname.startsWith(mine); } catch {}
        if (own) await del(p.url).catch(() => {});
      }
    await redis.del(`room:${room}`, `room:${room}:visited`,
                    `room:${room}:notes`, `room:${room}:photos`);
    return res.json({ ok: true });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const { name, password } = req.body || {};
  if (!name || typeof name !== "string" || name.length > 40)
    return res.status(400).json({ error: "지도 이름이 필요합니다" });
  if (!password || password.length < 4)
    return res.status(400).json({ error: "암호는 4자 이상이어야 합니다" });

  let id = "";
  for (let i = 0; i < 8; i++) id += ALPHA[crypto.randomInt(ALPHA.length)];
  const salt = crypto.randomBytes(8).toString("hex");
  const pwhash = hashPw(password, salt);
  await redis.hset(`room:${id}`, { name, salt, pwhash, created: Date.now() });
  res.json({ id, name, token: tokenOf(id, pwhash) });
}
