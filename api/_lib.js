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

export async function authRoom(req, room) {
  if (!validRoom(room)) return null;
  const meta = await redis.hgetall(`room:${room}`);
  if (!meta || !meta.pwhash) return null;
  const token = req.headers["x-token"];
  return token === tokenOf(room, meta.pwhash) ? meta : null;
}
