// api/health.js
import sql, { haveEnv, pingDb } from './_utils/db.js';

export default async function handler(req, res) {
  try {
    const env = haveEnv();
    const db = await pingDb();
    res.status(200).json({
      ok: true,
      db_ok: db.ok,
      db_error: db.ok ? undefined : db.error,
      env,
    });
  } catch (e) {
    res.status(200).json({ ok: true, db_ok: false, error: e.message, env: haveEnv() });
  }
}
