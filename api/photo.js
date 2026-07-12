import { put, del } from "@vercel/blob";
import { redis, authRoom } from "./_lib.js";

export default async function handler(req, res) {
  const { room, code } = req.query;
  if (!(await authRoom(req, room))) return res.status(403).json({ error: "unauthorized" });
  if (!/^\d+$/.test(code || "")) return res.status(400).json({ error: "bad code" });
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
    list.push({ url: blob.url, name });
    await redis.hset(key, { [code]: list });
    return res.json({ ok: true, url: blob.url, name });
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
