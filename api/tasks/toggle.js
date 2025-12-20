// api/tasks/toggle.js
import { q, ensureSchema } from '../_db.js';
import { getTgId, getOrCreateUserId, userTeamIds, isTeamOwner } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const id = Number(req.query?.id || req.body?.id);
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });

  // узнаем задачу
  const t = await q(
    `SELECT id, user_id, team_id, assigned_to_user_id, is_done
     FROM tasks
     WHERE id = $1`,
    [id]
  );
  if (!t.rows.length) return res.status(404).json({ ok: false, error: 'not found' });

  const task = t.rows[0];

  // личная
  if (!task.team_id) {
    if (Number(task.user_id) !== Number(userId)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
  } else {
    // командная — проверяем членство
    const teams = await userTeamIds(userId);
    if (!teams.includes(Number(task.team_id))) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    // если назначена — togglить может назначенный или владелец
    if (task.assigned_to_user_id) {
      const isAssignee = Number(task.assigned_to_user_id) === Number(userId);
      const isOwner = await isTeamOwner(userId, Number(task.team_id));
      if (!isAssignee && !isOwner) {
        return res.status(403).json({ ok: false, error: 'only assignee or owner can complete' });
      }
    }
  }

  const { rows } = await q(
    `UPDATE tasks
     SET is_done = NOT is_done
     WHERE id = $1
     RETURNING id, is_done, team_id, assigned_to_user_id`,
    [id],
  );

  res.json({ ok: true, task: rows[0] });
}
