// api/chat-store.js

import { db } from '../../lib/db'; // или твой _db / sql-обёртка

export default async function handler(req, res) {
  // достаём tg_id как в других ручках
  const tgIdHeader = (req.headers['x-tg-id'] || '').toString();
  const tgId = tgIdHeader ? Number(tgIdHeader) : null;

  if (!tgId) {
    return res.status(400).json({ ok: false, error: 'tg_id required' });
  }

  if (req.method === 'GET') {
    // вернуть список чатов
    try {
      const { rows } = await db.query(
        `SELECT id, title, data, created_at, updated_at
         FROM chat_threads
         WHERE tg_id = $1
         ORDER BY updated_at DESC`,
        [tgId]
      );
      return res.status(200).json({ ok: true, chats: rows });
    } catch (e) {
      console.error('[chat-store][GET]', e);
      return res.status(500).json({ ok: false, error: 'db_error' });
    }
  }

  if (req.method === 'POST') {
    // сохранить все чаты разом (как снимок)
    try {
      const body = await readJson(req);
      const chats = Array.isArray(body.chats) ? body.chats : [];

      // простой вариант: стереть старые и записать новые
      await db.query('BEGIN');
      await db.query('DELETE FROM chat_threads WHERE tg_id = $1', [tgId]);

      for (const ch of chats) {
        const title = (ch.title || 'Чат').toString().slice(0, 120);
        await db.query(
          `INSERT INTO chat_threads (tg_id, title, data)
           VALUES ($1, $2, $3::jsonb)`,
          [tgId, title, JSON.stringify(ch)]
        );
      }

      await db.query('COMMIT');
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[chat-store][POST]', e);
      try { await db.query('ROLLBACK'); } catch {}
      return res.status(500).json({ ok: false, error: 'db_error' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}

/* утилита чтения json Телом */
function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}
