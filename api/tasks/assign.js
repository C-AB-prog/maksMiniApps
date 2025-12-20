// api/tasks/assign.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId, userTeamIds, isTeamOwner } from '../_utils.js';

/**
 * POST /api/tasks/assign
 * body: { id: number, assigned_to_tg_id?: number, assigned_to_user_id?: number|null }
 *
 * Правила:
 * - задача должна быть командной (team_id != null)
 * - назначать может только владелец команды
 * - назначаемый должен быть участником команды
 * - можно снять назначение: assigned_to_user_id = null (или assigned_to_tg_id = null)
 */
export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });

  const meUserId = await getOrCreateUserId(tgId);

  const id = Number(req.body?.id || req.query?.id);
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });

  // грузим задачу
  const tr = await q(
    `SELECT id, user_id, team_id, assigned_to_user_id
     FROM tasks
     WHERE id = $1`,
    [id]
  );
  if (!tr.rows.length) return res.status(404).json({ ok: false, error: 'not found' });

  const task = tr.rows[0];
  if (!task.team_id) {
    return res.status(400).json({ ok: false, error: 'task is not a team task' });
  }

  const teamId = Number(task.team_id);

  // проверяем, что я в команде
  const myTeams = await userTeamIds(meUserId);
  if (!myTeams.includes(teamId)) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  // назначать может только владелец
  const owner = await isTeamOwner(meUserId, teamId);
  if (!owner) {
    return res.status(403).json({ ok: false, error: 'only owner can assign' });
  }

  // определяем кому назначаем
  let assignedToUserId = null;

  const assigned_to_user_id_raw = req.body?.assigned_to_user_id;
  const assigned_to_tg_id_raw = req.body?.assigned_to_tg_id;

  // если явно null/0/"" -> снять назначение
  const wantsClear =
    assigned_to_user_id_raw === null ||
    assigned_to_tg_id_raw === null ||
    assigned_to_user_id_raw === 0 ||
    assigned_to_tg_id_raw === 0 ||
    assigned_to_user_id_raw === '' ||
    assigned_to_tg_id_raw === '';

  if (!wantsClear) {
    // 1) либо по user_id
    const byUserId = Number(assigned_to_user_id_raw);
    if (byUserId) {
      assignedToUserId = byUserId;
    } else {
      // 2) либо по tg_id
      const byTgId = Number(assigned_to_tg_id_raw);
      if (!byTgId) {
        return res.status(400).json({ ok: false, error: 'assigned_to_user_id or assigned_to_tg_id required' });
      }
      const ur = await q(`SELECT id FROM users WHERE tg_id = $1`, [byTgId]);
      if (!ur.rows.length) return res.status(404).json({ ok: false, error: 'assignee user not found' });
      assignedToUserId = Number(ur.rows[0].id);
    }

    // проверяем, что назначаемый состоит в команде
    const mr = await q(
      `SELECT 1
       FROM team_members
       WHERE team_id = $1 AND user_id = $2`,
      [teamId, assignedToUserId]
    );
    if (!mr.rows.length) {
      return res.status(400).json({ ok: false, error: 'assignee is not a team member' });
    }
  }

  const upd = await q(
    `UPDATE tasks
     SET assigned_to_user_id = $1
     WHERE id = $2
     RETURNING id, team_id, assigned_to_user_id`,
    [assignedToUserId, id]
  );

  return res.json({ ok: true, task: upd.rows[0] });
}
