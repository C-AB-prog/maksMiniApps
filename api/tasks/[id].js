// /api/tasks/[id].js
import { sql } from '@vercel/postgres';
import { requireUser } from '../_utils/tg_node.js';
import { ensureSchema } from '../_utils/schema.js';

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  await ensureSchema();

  // id может прийти как строка/массив — нормализуем
  const idRaw = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'BAD_ID' });
  }

  try {
    if (req.method === 'PUT') {
      let { done } = req.body || {};
      // доп. нормализация срок: "true"/"1"
      if (typeof done === 'string') done = done === 'true' || done === '1';
      done = !!done;

      const result = await sql`
        UPDATE tasks
        SET done=${done}, updated_at=now()
        WHERE id=${id} AND user_id=${user.id}
      `;

      if ((result.rowCount || 0) === 0) {
        return res.status(404).json({ ok: false, error: 'TASK_NOT_FOUND' });
      }
      return res.status(200).json({ ok: true, id, done });
    }

    return res.status(405).end();
  } catch (e) {
    console.error('tasks/[id] error:', e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
