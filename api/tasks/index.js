// /api/tasks/index.js
import { sql } from '@vercel/postgres';
import { requireUser } from '../_utils/tg_node.js';

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const list = req.query.list || 'today';
      const { rows } = await sql`
        SELECT id, title, list, note, icon, done, deadline
        FROM tasks
        WHERE user_id=${user.id} AND list=${list}
        ORDER BY created_at DESC
        LIMIT 50
      `;
      res.status(200).json({ items: rows });
      return;
    }

    if (req.method === 'POST') {
      const { title = '', list = 'today', note = '', icon = '🧩', deadline = null } = req.body || {};
      const { rows } = await sql`
        INSERT INTO tasks (user_id, title, list, note, icon, deadline)
        VALUES (${user.id}, ${title}, ${list}, ${note}, ${icon}, ${deadline})
        RETURNING id, title, list, note, icon, done, deadline
      `;
      res.status(200).json(rows[0]);
      return;
    }

    res.status(405).end();
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
