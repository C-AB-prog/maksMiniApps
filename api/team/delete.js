// api/team/delete.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId, isTeamOwner } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok:false, error:'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const teamId = Number(req.query?.id || req.body?.id);
  if (!teamId) return res.status(400).json({ ok:false, error:'id required' });

  const owner = await isTeamOwner(userId, teamId);
  if (!owner) return res.status(403).json({ ok:false, error:'not_owner' });

  await q(`DELETE FROM teams WHERE id = $1`, [teamId]);
  res.json({ ok:true });
}
