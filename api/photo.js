import { put, del } from "@vercel/blob";
import { redis, authRoom } from "./_lib.js";

// 백업 복원은 이미 올라간 사진 URL만 다시 연결한다.
// 외부 주소를 끼워 넣지 못하도록 우리 저장소 도메인만 허용.
function isOwnPhotoUrl(u) {
  if (typeof u !== "string") return false;
  try {
    return new URL(u).hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const { room, code, vid } = req.query;
  if (!(await authRoom(req, room))) return res.status(403).json({ error: "unauthorized" });
  if (!/^\d+$/.test(code || "")) return res.status(400).json({ error: "bad code" });
  // vid = 어느 방문 기록에 속한 사진인지 (없으면 방문일 미지정)
  const visitId = typeof vid === "string" && /^[\w-]{1,40}$/.test(vid) ? vid : "";
  const key = `room:${room}:photos`;

  if (req.method === "POST") {
    // 백업 복원 — 새로 올리지 않고 기존 사진 URL만 이 지역에 다시 연결
    if (req.query.link === "1") {
      const b = req.body || {};
      if (!isOwnPhotoUrl(b.url)) return res.status(400).json({ error: "bad url" });
      const list = (await redis.hget(key, code)) || [];
      if (!list.some((p) => p.url === b.url)) {
        list.push({
          url: b.url,
          name: String(b.name || "photo.jpg").replace(/[^\w.\-가-힣 ]/g, "_").slice(-80),
          vid: typeof b.vid === "string" && /^[\w-]{1,40}$/.test(b.vid) ? b.vid : "",
          ...(isOwnPhotoUrl(b.thumb) ? { thumb: b.thumb } : {}),
        });
        await redis.hset(key, { [code]: list });
      }
      return res.json({ ok: true, url: b.url });
    }
    const name = decodeURIComponent(req.headers["x-filename"] || "photo.jpg")
      .replace(/[^\w.\-가-힣 ]/g, "_").slice(-80) || "photo.jpg";
    const body = req.body;
    if (!body || !body.length) return res.status(400).json({ error: "empty body" });
    if (body.length > 8 * 1024 * 1024) return res.status(400).json({ error: "too large" });

    // 목록용 작은 사진 — 원본은 1600px라 58px 칸에 쓰면 낭비가 크다.
    // 원본을 올린 뒤 그 주소를 thumbfor로 넘겨 같은 항목에 붙인다.
    const thumbFor = req.query.thumbfor;
    if (thumbFor) {
      if (!isOwnPhotoUrl(thumbFor)) return res.status(400).json({ error: "bad url" });
      const list = (await redis.hget(key, code)) || [];
      const idx = list.findIndex((p) => p.url === thumbFor);
      if (idx < 0) return res.status(404).json({ error: "not found" });
      const tb = await put(`rooms/${room}/${code}/t_${Date.now()}_${name}`, body, {
        access: "public",
      });
      list[idx] = { ...list[idx], thumb: tb.url };
      await redis.hset(key, { [code]: list });
      return res.json({ ok: true, thumb: tb.url });
    }
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

    // 지역 통합 시 사진의 코드 버킷도 함께 이동
    const to = typeof req.query.to === "string" && /^\d+$/.test(req.query.to) ? req.query.to : "";
    if (to && to !== code) {
      const item = list[idx];
      const target = (await redis.hget(key, to)) || [];
      if (!target.some((p) => p.url === url)) target.push(item);
      await redis.hset(key, { [to]: target });
      list.splice(idx, 1);
      if (list.length) await redis.hset(key, { [code]: list });
      else await redis.hdel(key, code);
      return res.json({ ok: true, vid: item.vid || "", code: to });
    }

    list[idx] = { ...list[idx], vid: visitId };
    await redis.hset(key, { [code]: list });
    return res.json({ ok: true, vid: visitId });
  }

  if (req.method === "DELETE") {
    const { url } = req.body || {};
    const list = (await redis.hget(key, code)) || [];
    const gone = list.find((p) => p.url === url);
    if (gone) {
      await del(url).catch(() => {});
      if (gone.thumb) await del(gone.thumb).catch(() => {});   // 목록용 사진도 함께
      const rest = list.filter((p) => p.url !== url);
      if (rest.length) await redis.hset(key, { [code]: rest });
      else await redis.hdel(key, code);
    }
    return res.json({ ok: true });
  }

  res.status(405).json({ error: "method not allowed" });
}
