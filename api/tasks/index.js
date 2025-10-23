// /api/tasks/index.js
import { sql } from '@vercel/postgres';
import { requireUser } from '../_utils/tg_node.js';
import { ensureTables } from '../_utils/schema.js';

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  await ensureTables();

  try {
    if (req.method === 'GET') {
      const list = (req.query.list || 'today').toString();
      const { rows } = await sql`
        SELECT id, title, list, note, icon, done, deadline
        FROM tasks
        WHERE user_id=${user.id} AND list=${list}
        ORDER BY created_at DESC
        LIMIT 100
      `;
      return res.status(200).json({ items: rows });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const title = (body.title || '').toString().trim();
      if (!title) return res.status(422).json({ ok: false, error: 'TITLE_REQUIRED' });

      const list = (body.list || 'today').toString();
      const note = (body.note || '').toString();
      const icon = (body.icon || '🧩').toString();
      const deadline = body.deadline ?? null;

      const { rows } = await sql`
        INSERT INTO tasks (user_id, title, list, note, icon, deadline)
        VALUES (${user.id}, ${title}, ${list}, ${note}, ${icon}, ${deadline})
        RETURNING id, title, list, note, icon, done, deadline
      `;
      return res.status(200).json(rows[0]);
    }

    return res.status(405).end();
  } catch (e) {
    console.error('tasks/index error:', e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
