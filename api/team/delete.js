// api/team/delete.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'POST') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) {
    return res.status(400).json({ ok: false, error: 'tg_id required' });
  }
  const userId = await getOrCreateUserId(tgId);

  const teamId = Number(req.body?.team_id);
  if (!teamId) {
    return res.status(400).json({ ok: false, error: 'team_id required' });
  }

  // только создатель (первый участник) может удалить команду
  const own = await q(
    `
    SELECT user_id
    FROM team_members
    WHERE team_id = $1
    ORDER BY joined_at ASC
    LIMIT 1
    `,
    [teamId],
  );

  if (!own.rows.length || Number(own.rows[0].user_id) !== userId) {
    return res.status(403).json({ ok: false, error: 'only owner can delete' });
  }

  await q(`DELETE FROM teams WHERE id = $1`, [teamId]);

  res.json({ ok: true });
}
