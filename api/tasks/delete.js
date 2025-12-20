// api/tasks/delete.js
import { q, ensureSchema } from '../_db.js';
import { getTgId, getOrCreateUserId, userTeamIds, isTeamOwner } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const id = Number(req.query?.id || req.body?.id);
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });

  const t = await q(
    `SELECT id, user_id, team_id
     FROM tasks
     WHERE id = $1`,
    [id]
  );
  if (!t.rows.length) return res.status(404).json({ ok: false, error: 'not found' });

  const task = t.rows[0];

  if (!task.team_id) {
    if (Number(task.user_id) !== Number(userId)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
  } else {
    const teams = await userTeamIds(userId);
    const teamId = Number(task.team_id);
    if (!teams.includes(teamId)) return res.status(403).json({ ok: false, error: 'forbidden' });

    const creator = Number(task.user_id) === Number(userId);
    const owner = await isTeamOwner(userId, teamId);
    if (!creator && !owner) {
      return res.status(403).json({ ok: false, error: 'only creator or owner can delete' });
    }
  }

  const { rows } = await q(
    `DELETE FROM tasks WHERE id = $1 RETURNING id`,
    [id],
  );

  res.json({ ok: true, id: rows[0].id });
}
