// api/team/invite.js
import { ensureSchema } from '../_db.js';
import { getTgId, getOrCreateUserId, getUserTeams, createTeam, assertUserInTeam } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'GET') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  let teamId = Number(req.query?.team_id || 0);
  let team;

  if (teamId) {
    const ok = await assertUserInTeam(userId, teamId);
    if (!ok) return res.status(403).json({ ok:false, error:'not_in_team' });

    const list = await getUserTeams(userId);
    team = list.find(t => t.id === teamId);
    if (!team) return res.status(404).json({ ok:false, error:'team_not_found' });
  } else {
    const list = await getUserTeams(userId);
    if (list.length) team = list[0];
    else team = await createTeam(userId, tgId, `Команда ${tgId}`);
  }

  res.json({
    ok: true,
    team_id: team.id,
    join_code: team.join_token
  });
}
