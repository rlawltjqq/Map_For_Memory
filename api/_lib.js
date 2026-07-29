import crypto from "node:crypto";
import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const hashPw = (pw, salt) =>
  crypto.scryptSync(pw, salt, 32).toString("hex");

export const tokenOf = (id, pwhash) =>
  crypto.createHash("sha256").update(`${id}:${pwhash}`).digest("hex");

export const validRoom = (room) => /^[a-z0-9]{6,12}$/.test(room || "");

// 길이가 달라도 예외 없이 상수 시간 비교 (토큰·해시 비교용)
export function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

// 인증 + 방 메타를 함께 반환 (호출부에서 hgetall 재호출 불필요)
export async function authRoom(req, room) {
  if (!validRoom(room)) return null;
  const meta = await redis.hgetall(`room:${room}`);
  if (!meta || !meta.pwhash) return null;
  return safeEqual(req.headers["x-token"], tokenOf(room, meta.pwhash)) ? meta : null;
}
