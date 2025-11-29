// api/team/members.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId, getUserTeams, assertUserInTeam } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'GET') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  let teamId = Number(req.query?.team_id || 0);

  if (!teamId) {
    const list = await getUserTeams(userId);
    if (!list.length) {
      return res.json({ ok: true, team_id: null, members: [] });
    }
    teamId = list[0].id;
  } else {
    const ok = await assertUserInTeam(userId, teamId);
    if (!ok) return res.status(403).json({ ok:false, error:'not_in_team' });
  }

  const u = await q(
    `SELECT u.tg_id, u.username, u.first_name, u.last_name
     FROM team_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.team_id = $1
     ORDER BY u.tg_id`,
    [teamId]
  );

  res.json({ ok: true, team_id: teamId, members: u.rows });
}
