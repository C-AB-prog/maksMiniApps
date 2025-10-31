import { ensureSchema } from '../_db.js';
import { getTgId, getOrCreateUserId, userTeamIds, ensureDefaultTeamForUser } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok:false, error:'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const ids = await userTeamIds(userId);
  if (ids.length === 0) {
    const t = await ensureDefaultTeamForUser(userId, tgId);
    return res.json({ ok:true, team_id: t.id });
  }
  res.json({ ok:true, team_id: ids[0] });
}
