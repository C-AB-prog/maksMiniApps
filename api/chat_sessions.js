// api/chat_sessions.js
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

async function dbQuery(text, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res.rows;
  } finally {
    client.release();
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const tgId =
      (req.headers['x-tg-id'] || '').toString() ||
      (req.query.tg_id || '').toString();

    if (!tgId) {
      return res.status(200).json({ ok: true, sessions: [] });
    }

    const rows = await dbQuery(
      `SELECT id, title, created_at, updated_at
       FROM chat_sessions
       WHERE tg_id = $1
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 50`,
      [tgId]
    );

    return res.status(200).json({ ok: true, sessions: rows });
  } catch (e) {
    console.error('[chat_sessions] error', e);
    return res.status(200).json({ ok: true, sessions: [] });
  }
}
