// /api/focus.js
import { sql } from '@vercel/postgres';
import { requireUser } from './_utils/tg_node.js';

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return; // уже отдан 401

  const day = (req.method === 'GET' ? req.query.day : (req.body?.day)) || new Date().toISOString().slice(0, 10);

  try {
    if (req.method === 'GET') {
      const { rows } = await sql`
        SELECT text, meta, progress_pct
        FROM focus
        WHERE user_id=${user.id} AND day=${day}
        LIMIT 1
      `;
      res.status(200).json(rows[0] || { text: '', meta: '', progress_pct: 0 });
      return;
    }

    if (req.method === 'PUT') {
      const { text = '', meta = '', progress_pct = 45 } = req.body || {};
      await sql`
        INSERT INTO focus (user_id, day, text, meta, progress_pct)
        VALUES (${user.id}, ${day}, ${text}, ${meta}, ${progress_pct})
        ON CONFLICT (user_id, day)
        DO UPDATE SET text=${text}, meta=${meta}, progress_pct=${progress_pct}, updated_at=now()
      `;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).end();
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
