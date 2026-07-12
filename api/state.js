import { redis, authRoom } from "./_lib.js";

export default async function handler(req, res) {
  const room = req.query.room;
  const meta = await authRoom(req, room);
  if (!meta) return res.status(403).json({ error: "unauthorized" });
  const [visited, photos] = await Promise.all([
    redis.smembers(`room:${room}:visited`),
    redis.hgetall(`room:${room}:photos`),
  ]);
  res.setHeader("Cache-Control", "no-store");
  res.json({ name: meta.name, visited: visited || [], photos: photos || {} });
}
