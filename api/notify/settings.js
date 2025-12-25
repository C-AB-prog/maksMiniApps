// api/notify/settings.js (CommonJS)

const { ensureSchema, query, getOrCreateUserIdByTgId } = require('../_db');

function getTgId(req) {
  const h = req.headers || {};
  const q = req.query || {};
  const v = h['x-tg-id'] || h['X-TG-ID'] || q.tg_id || q.tgId || q.tgid;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function clampInt(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

module.exports = async (req, res) => {
  try {
    await ensureSchema();

    const tgId = getTgId(req);
    if (!tgId) return res.status(400).json({ ok: false, error: 'no_tg_id' });

    const userId = await getOrCreateUserIdByTgId(tgId);

    if (req.method === 'GET') {
      const r = await query(
        `SELECT user_id, enabled, interval_hours, start_hour, end_hour, tz_offset_min, last_sent_at
         FROM notification_prefs WHERE user_id=$1`,
        [userId]
      );

      if (r.rows.length) {
        return res.json({ ok: true, settings: r.rows[0] });
      }

      // create default row
      const ins = await query(
        `INSERT INTO notification_prefs (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING user_id, enabled, interval_hours, start_hour, end_hour, tz_offset_min, last_sent_at`,
        [userId]
      );

      return res.json({ ok: true, settings: ins.rows[0] || { user_id: userId, enabled: false, interval_hours: 4, start_hour: 9, end_hour: 21, tz_offset_min: 0, last_sent_at: null } });
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      const enabled = !!body.enabled;
      const interval_hours = clampInt(body.interval_hours ?? 4, 1, 24, 4);
      const start_hour = clampInt(body.start_hour ?? 9, 0, 23, 9);
      const end_hour = clampInt(body.end_hour ?? 21, 0, 23, 21);
      const tz_offset_min = clampInt(body.tz_offset_min ?? 0, -840, 840, 0);

      // if enabling, we clear last_sent_at so user gets next slot naturally
      const lastSentExpr = enabled ? 'NULL' : 'last_sent_at';

      const r = await query(
        `INSERT INTO notification_prefs (user_id, enabled, interval_hours, start_hour, end_hour, tz_offset_min, last_sent_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NULL, now())
         ON CONFLICT (user_id)
         DO UPDATE SET
           enabled = EXCLUDED.enabled,
           interval_hours = EXCLUDED.interval_hours,
           start_hour = EXCLUDED.start_hour,
           end_hour = EXCLUDED.end_hour,
           tz_offset_min = EXCLUDED.tz_offset_min,
           last_sent_at = ${lastSentExpr},
           updated_at = now()
         RETURNING user_id, enabled, interval_hours, start_hour, end_hour, tz_offset_min, last_sent_at`,
        [userId, enabled, interval_hours, start_hour, end_hour, tz_offset_min]
      );

      return res.json({ ok: true, settings: r.rows[0] });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};
