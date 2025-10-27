// api/health.js
import { ensureSchema } from './_db.js';
import { json } from './_utils.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    json(res, 200, { ok:true, env: process.env.VERCEL_ENV || 'production',
      region: process.env.VERCEL_REGION || 'unknown', time: new Date().toISOString() });
  } catch (e) {
    json(res, 500, { ok:false, error: e.message });
  }
}
