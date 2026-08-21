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

// 읽고-고쳐-쓰기를 감싸는 짧은 잠금.
// 서버리스 인스턴스는 서로 다른 프로세스라 메모리 락이 통하지 않는다.
// 같은 방의 같은 자원을 동시에 고칠 때 한쪽이 통째로 날아가는 것을 막는다.
export async function withLock(name, fn, { tries = 12, ttl = 5 } = {}) {
  const key = `lock:${name}`;
  const token = crypto.randomUUID();
  for (let i = 0; i < tries; i++) {
    if (await redis.set(key, token, { nx: true, ex: ttl })) {
      try {
        return await fn();
      } finally {
        // 내가 잡은 잠금일 때만 푼다 (만료 뒤 남의 잠금을 풀지 않도록)
        if ((await redis.get(key)) === token) await redis.del(key);
      }
    }
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 90));
  }
  // 끝내 못 잡으면 잠금 없이 진행한다 — 막히는 것보다 낫다
  return fn();
}
