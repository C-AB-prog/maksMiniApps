import { q, ensureSchema } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  if (req.method === 'GET') {
    const { rows } = await q(
      `SELECT id, title, due_ts, is_done, created_at
       FROM tasks
       WHERE user_id = $1
       ORDER BY COALESCE(due_ts, 9223372036854775807), id DESC
       LIMIT 200`,
      [userId],
    );
    return res.json({ ok: true, items: rows });
  }

  if (req.method === 'POST') {
    const title = (req.body?.title || '').trim();
    const due_ts = req.body?.due_ts ?? null; // либо null, либо число (ms)
    if (!title) return res.status(400).json({ ok: false, error: 'title required' });

    const { rows } = await q(
      `INSERT INTO tasks (user_id, title, due_ts)
       VALUES ($1, $2, $3)
       RETURNING id, title, due_ts, is_done, created_at`,
      [userId, title, due_ts],
    );
    return res.json({ ok: true, task: rows[0] });
  }

  return res.status(405).end();
}
