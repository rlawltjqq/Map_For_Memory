// 지연 측정용 — Redis를 건드리지 않아 '함수까지의 왕복'만 잰다.
// /api/state와 비교하면 Redis 왕복 시간이 분리된다.
export default function handler(req, res) {
  res.status(200).json({ ok: true, region: process.env.VERCEL_REGION || "?" });
}
