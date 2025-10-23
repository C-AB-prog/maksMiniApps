// /api/health.js
import { ensureSchema } from './_utils/schema.js';

export default async function handler(req, res) {
  const env = {
    has_POSTGRES_URL: !!process.env.POSTGRES_URL,
    allow_unsigned: process.env.ALLOW_UNSIGNED || '0',
    has_bot_token: !!process.env.BOT_TOKEN,
  };

  try {
    await ensureSchema();
    return res.status(200).json({ ok: true, db_ok: true, env });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      db_ok: false,
      error: e?.message || String(e),
      env
    });
  }
}
