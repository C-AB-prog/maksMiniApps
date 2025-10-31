import { ensureSchema } from '../_db.js';
import { getTgId, getOrCreateUserId, joinByToken } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok:false, error:'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const token = (req.query?.token || req.body?.token || '').toString().trim();
  if (!token) return res.status(400).json({ ok:false, error:'token required' });

  const teamId = await joinByToken(userId, token);
  if (!teamId) return res.status(404).json({ ok:false, error:'team not found' });

  res.json({ ok:true, team_id: teamId });
}
