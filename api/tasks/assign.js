// api/tasks/assign.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId, isTeamOwner } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok:false, error:'method not allowed' });
  }

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok:false, error:'tg_id required' });

  const meUserId = await getOrCreateUserId(tgId);

  const task_id = Number(req.body?.task_id || req.query?.task_id);
  const assigned_to_user_id = req.body?.assigned_to_user_id == null ? null : Number(req.body.assigned_to_user_id);

  if (!task_id) return res.status(400).json({ ok:false, error:'task_id required' });

  const t = await q(
    `SELECT id, team_id
     FROM tasks
     WHERE id = $1`,
    [task_id]
  );
  if (!t.rows.length) return res.status(404).json({ ok:false, error:'not found' });

  const task = t.rows[0];
  if (!task.team_id) return res.status(400).json({ ok:false, error:'task is not team task' });

  const owner = await isTeamOwner(meUserId, Number(task.team_id));
  if (!owner) return res.status(403).json({ ok:false, error:'only team owner can assign' });

  if (assigned_to_user_id) {
    const m = await q(
      `SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2`,
      [Number(task.team_id), assigned_to_user_id]
    );
    if (!m.rows.length) return res.status(400).json({ ok:false, error:'assignee not in team' });
  }

  const upd = await q(
    `UPDATE tasks
     SET assigned_to_user_id = $2
     WHERE id = $1
     RETURNING id, team_id, assigned_to_user_id`,
    [task_id, assigned_to_user_id]
  );

  return res.json({ ok:true, task: upd.rows[0] });
}
