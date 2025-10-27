import { q, ensureSchema } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const id = Number(req.query?.id || req.body?.id);
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });

  const { rows } = await q(
    `DELETE FROM tasks
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [id, userId],
  );

  if (!rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, id: rows[0].id });
}
