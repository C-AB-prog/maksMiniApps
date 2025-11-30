// api/chat_history.js
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

async function dbOne(text, params = []) {
  const rows = await dbQuery(text, params);
  return rows[0] || null;
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
    const chatId = Number(req.query.chat_id || 0);

    if (!tgId || !chatId) {
      return res.status(200).json({ ok: true, messages: [] });
    }

    const session = await dbOne(
      'SELECT id FROM chat_sessions WHERE id = $1 AND tg_id = $2',
      [chatId, tgId]
    );
    if (!session) {
      return res.status(200).json({ ok: true, messages: [] });
    }

    const rows = await dbQuery(
      `SELECT role, content, created_at
       FROM chat_messages
       WHERE session_id = $1
       ORDER BY id ASC`,
      [chatId]
    );

    return res.status(200).json({ ok: true, messages: rows });
  } catch (e) {
    console.error('[chat_history] error', e);
    return res.status(200).json({ ok: true, messages: [] });
  }
}
