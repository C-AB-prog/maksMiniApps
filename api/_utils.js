// /api/_utils.js
export function getTgIdFromReq(req) {
  const pick = v => (Array.isArray(v) ? v[0] : v);
  let raw =
    pick(req.headers['x-tg-id']) ??
    pick(req.body?.tg_id) ??
    pick(req.query?.tg_id) ??
    '';

  raw = String(raw).trim();
  if (!raw) return null;

  const num = Number(raw);
  if (!Number.isFinite(num)) return null;

  return Math.trunc(num);
}
