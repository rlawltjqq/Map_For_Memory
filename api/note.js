import { redis, authRoom, withLock } from "./_lib.js";

// 지역별 방문 기록: { visits: [ { start:"2026-07-15", end:"2026-07-16", memo:"..." }, ... ] }
function isDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const { room, code, visits, removed } = req.body || {};
  if (!(await authRoom(req, room))) return res.status(403).json({ error: "unauthorized" });
  if (!/^\d+$/.test(String(code || ""))) return res.status(400).json({ error: "bad code" });
  if (!Array.isArray(visits)) return res.status(400).json({ error: "bad visits" });

  const clean = visits.slice(0, 50).map((v) => ({
    id: typeof (v && v.id) === "string" && /^[\w-]{1,40}$/.test(v.id) ? v.id : "",
    start: isDate(v && v.start) ? v.start : "",
    end: isDate(v && v.end) ? v.end : "",
    memo: typeof (v && v.memo) === "string" ? v.memo.slice(0, 500) : "",
  })).filter((v) => v.id || v.start || v.end || v.memo);

  const key = `room:${room}:notes`;

  // 같이 쓰는 지도에서 두 사람이 같은 지역에 기록을 남기면, 통째로 덮어쓸 때
  // 먼저 저장된 쪽이 사라진다. 방문마다 고유 id가 있으므로 항목 단위로 합친다.
  // removed(지운 id 목록)를 함께 받아야 '안 보낸 항목'이 삭제인지 모르는 것인지
  // 구분할 수 있다. removed가 없으면 예전 방식(전체 교체)으로 둔다.
  if (!Array.isArray(removed)) {
    // 옛 클라이언트: 종전대로 전체 교체
    if (clean.length === 0) await redis.hdel(key, String(code));
    else await redis.hset(key, { [String(code)]: { visits: clean } });
    return res.json({ ok: true, visits: clean });
  }

  // 읽고-고쳐-쓰기라 잠금이 없으면 동시에 저장할 때 한쪽이 사라진다
  const merged = await withLock(`${room}:notes:${code}`, async () => {
    const gone = new Set(removed.filter((x) => typeof x === "string").map(String));
    const prev = ((await redis.hget(key, String(code))) || {}).visits || [];
    const byId = new Map();
    for (const v of prev) if (v && v.id && !gone.has(v.id)) byId.set(v.id, v);
    for (const v of clean) if (v.id) byId.set(v.id, v);      // 내 변경이 우선
    // id 없는 예전 자료는 지울 방법이 없어 중복으로 남는다.
    // 같은 내용이 id 있는 항목으로 들어와 있으면 옛 항목은 버린다.
    const same = new Set([...byId.values()].map((v) => `${v.start}|${v.end}|${v.memo}`));
    const noId = prev.filter((v) => v && !v.id && !same.has(`${v.start}|${v.end}|${v.memo}`));
    // 상한을 넘으면 방금 저장한 항목이 아니라 오래된 것부터 버린다
    const all = [...noId, ...byId.values()];
    const out = all.length <= 50 ? all : all.slice(all.length - 50);

    if (out.length === 0) await redis.hdel(key, String(code));
    else await redis.hset(key, { [String(code)]: { visits: out } });
    return out;
  });
  res.json({ ok: true, visits: merged });
}
