import { q, ensureSchema } from '../_db.js';
import { getTgId, getOrCreateUserId, userTeamIds } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const id = Number(req.query?.id || req.body?.id);
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });

  const teams = await userTeamIds(userId);

  const { rows } = await q(
    `UPDATE tasks
     SET is_done = NOT is_done
     WHERE id = $1
       AND (user_id = $2 OR (team_id IS NOT NULL AND team_id = ANY($3::bigint[])))
     RETURNING id, is_done, team_id`,
    [id, userId, teams.length ? teams : [0]],
  );

  if (!rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, task: rows[0] });
}
