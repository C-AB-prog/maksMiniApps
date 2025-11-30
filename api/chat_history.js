// api/chat_history.js
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function ensureUser(client, tgId) {
  const idNum = Number(tgId);
  if (!idNum) throw new Error('tg_id required');

  const r = await client.query(
    'SELECT id FROM users WHERE tg_id = $1',
    [idNum]
  );
  if (r.rows[0]) return r.rows[0].id;

  const ins = await client.query(
    'INSERT INTO users (tg_id) VALUES ($1) RETURNING id',
    [idNum]
  );
  return ins.rows[0].id;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const tgIdHeader = (req.headers['x-tg-id'] || '').toString();
    const tgId = tgIdHeader || (req.query.tg_id || '').toString();
    const chatId = Number(req.query.chat_id || 0);

    if (!tgId || !chatId) {
      return res.status(200).json({ ok: true, messages: [] });
    }

    const messages = await withClient(async (client) => {
      const userId = await ensureUser(client, tgId);

      const s = await client.query(
        'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
        [chatId, userId]
      );
      if (!s.rows[0]) return [];

      const r = await client.query(
        `SELECT role, content, created_at
         FROM chat_messages
         WHERE chat_id = $1
         ORDER BY id ASC`,
        [chatId]
      );
      return r.rows || [];
    });

    return res.status(200).json({ ok: true, messages });
  } catch (e) {
    console.error('[chat_history] error', e);
    return res.status(200).json({ ok: true, messages: [] });
  }
}
