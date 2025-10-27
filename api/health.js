// /api/health.js
import { ensureSchema, pool } from './_db';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const r = await pool.query('select current_database() as db, now() as ts');
    res.json({
      ok: true,
      env: process.env.NODE_ENV,
      region: process.env.VERCEL_REGION || 'unknown',
      time: r.rows[0].ts,
      db: r.rows[0].db,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
