// /api/tasks/[id].js
import { sql } from '@vercel/postgres';
import { requireUser } from '../_utils/tg_node.js';
import { ensureSchema } from '../_utils/schema.js';

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  await ensureSchema();

  const id = req.query.id;
  if (!id) return res.status(400).json({ ok: false, error: 'NO_ID' });

  try {
    if (req.method === 'PUT') {
      const { done } = req.body || {};
      await sql`
        UPDATE tasks
        SET done=${!!done}, updated_at=now()
        WHERE id=${id} AND user_id=${user.id}
      `;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
