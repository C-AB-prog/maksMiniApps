import { ensureSchema } from './_db.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    res.json({
      ok: true,
      env: process.env.NODE_ENV,
      region: process.env.VERCEL_REGION || 'local',
      time: new Date().toISOString(),
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
