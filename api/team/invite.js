import { ensureSchema } from '../_db.js';
import { getTgId, getOrCreateUserId, ensureDefaultTeamForUser, baseUrlFromReq } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok:false, error:'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const team = await ensureDefaultTeamForUser(userId, tgId);
  const link = `${baseUrlFromReq(req)}/?join=${team.join_token}`;

  res.json({ ok:true, team_id: team.id, invite_link: link });
}
