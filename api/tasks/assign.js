// api/tasks/assign.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId, userTeamIds, isTeamOwner } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });

  const meUserId = await getOrCreateUserId(tgId);

  const task_id = Number(req.body?.task_id);
  const assignee_username_raw = req.body?.assignee_username;

  if (!task_id) return res.status(400).json({ ok: false, error: 'task_id required' });

  const t = await q(
    `SELECT id, team_id, user_id, assigned_to_user_id
     FROM tasks
     WHERE id = $1`,
    [task_id]
  );
  if (!t.rows.length) return res.status(404).json({ ok: false, error: 'not found' });

  const task = t.rows[0];
  const teamId = task.team_id ? Number(task.team_id) : 0;
  if (!teamId) return res.status(400).json({ ok: false, error: 'task is not a team task' });

  // должен быть участником команды
  const myTeams = await userTeamIds(meUserId);
  if (!myTeams.includes(teamId)) return res.status(403).json({ ok: false, error: 'forbidden' });

  // только админ
  const owner = await isTeamOwner(meUserId, teamId);
  if (!owner) return res.status(403).json({ ok: false, error: 'only team owner can assign' });

  // снять назначение
  if (assignee_username_raw === null || assignee_username_raw === undefined || String(assignee_username_raw).trim() === '') {
    const upd = await q(
      `UPDATE tasks
       SET assigned_to_user_id = NULL
       WHERE id = $1
       RETURNING id, assigned_to_user_id`,
      [task_id]
    );
    return res.json({ ok: true, task: upd.rows[0] });
  }

  const uname = String(assignee_username_raw).trim().replace(/^@/, '').toLowerCase();
  if (!uname) return res.status(400).json({ ok: false, error: 'assignee_username required' });

  // ищем пользователя по username
  const u = await q(
    `SELECT id, tg_id, username
     FROM users
     WHERE lower(username) = $1
     LIMIT 1`,
    [uname]
  );
  if (!u.rows.length) {
    return res.status(404).json({ ok: false, error: 'user with this username not found (ask them to open app once)' });
  }

  const assigneeUserId = Number(u.rows[0].id);

  // проверим что он в команде
  const mem = await q(
    `SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2`,
    [teamId, assigneeUserId]
  );
  if (!mem.rows.length) return res.status(400).json({ ok: false, error: 'assignee is not a member of this team' });

  const upd = await q(
    `UPDATE tasks
     SET assigned_to_user_id = $2
     WHERE id = $1
     RETURNING id, assigned_to_user_id`,
    [task_id, assigneeUserId]
  );

  return res.json({ ok: true, task: upd.rows[0] });
}
