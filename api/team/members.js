// api/team/members.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId, userTeamIds, isTeamOwner } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });

  const meUserId = await getOrCreateUserId(tgId);

  // team_id optional: если не передали — берём первую команду пользователя
  let teamId = req.query?.team_id ? Number(req.query.team_id) : null;

  const myTeams = await userTeamIds(meUserId);
  if (!myTeams.length) {
    return res.json({ ok: true, members: [], me_is_owner: false, team_id: null });
  }

  if (!teamId) teamId = myTeams[0];
  if (!myTeams.includes(teamId)) return res.status(403).json({ ok: false, error: 'forbidden' });

  const owner = await isTeamOwner(meUserId, teamId);

  const r = await q(
    `SELECT u.id as user_id, u.tg_id, u.username, u.first_name, u.last_name,
            m.joined_at
     FROM team_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.team_id = $1
     ORDER BY m.joined_at ASC`,
    [teamId]
  );

  // ВАЖНО: фронт читает m.username / m.first_name / m.last_name / m.tg_id
  // А также ему по сути всё равно "is_admin", но мы можем дать owner-флаг для первого участника.
  const members = r.rows.map((x, idx) => ({
    user_id: Number(x.user_id),
    tg_id: Number(x.tg_id),
    username: x.username || null,
    first_name: x.first_name || null,
    last_name: x.last_name || null,
    is_owner: idx === 0, // если у тебя нет owner_user_id в таблице teams
  }));

  return res.json({ ok: true, members, me_is_owner: owner, team_id: teamId });
}
