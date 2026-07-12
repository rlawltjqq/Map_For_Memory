import crypto from "node:crypto";
import { redis, hashPw, tokenOf } from "./_lib.js";

const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";

export default async function handler(req, res) {
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
