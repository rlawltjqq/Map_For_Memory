import { put, del } from "@vercel/blob";
import { redis, authRoom } from "./_lib.js";

export default async function handler(req, res) {
  const { room, code, vid } = req.query;
  if (!(await authRoom(req, room))) return res.status(403).json({ error: "unauthorized" });
  if (!/^\d+$/.test(code || "")) return res.status(400).json({ error: "bad code" });
  // vid = 어느 방문 기록에 속한 사진인지 (없으면 방문일 미지정)
  const visitId = typeof vid === "string" && /^[\w-]{1,40}$/.test(vid) ? vid : "";
  const key = `room:${room}:photos`;

  if (req.method === "POST") {
    const name = decodeURIComponent(req.headers["x-filename"] || "photo.jpg")
      .replace(/[^\w.\-가-힣 ]/g, "_").slice(-80) || "photo.jpg";
    const body = req.body;
    if (!body || !body.length) return res.status(400).json({ error: "empty body" });
    if (body.length > 8 * 1024 * 1024) return res.status(400).json({ error: "too large" });
    const blob = await put(`rooms/${room}/${code}/${Date.now()}_${name}`, body, {
      access: "public",
    });
    const list = (await redis.hget(key, code)) || [];
    list.push({ url: blob.url, name, vid: visitId });
    await redis.hset(key, { [code]: list });
    return res.json({ ok: true, url: blob.url, name, vid: visitId });
  }

  // 사진을 다른 방문 기록으로 이동 (vid="" 이면 미지정으로)
  if (req.method === "PUT") {
    const { url } = req.body || {};
    const list = (await redis.hget(key, code)) || [];
    const idx = list.findIndex((p) => p.url === url);
    if (idx < 0) return res.status(404).json({ error: "not found" });
    list[idx] = { ...list[idx], vid: visitId };
    await redis.hset(key, { [code]: list });
    return res.json({ ok: true, vid: visitId });
  }

  if (req.method === "DELETE") {
    const { url } = req.body || {};
    const list = (await redis.hget(key, code)) || [];
    if (list.some((p) => p.url === url)) {
      await del(url).catch(() => {});
      const rest = list.filter((p) => p.url !== url);
      if (rest.length) await redis.hset(key, { [code]: rest });
      else await redis.hdel(key, code);
    }
    return res.json({ ok: true });
  }

  res.status(405).json({ error: "method not allowed" });
}
