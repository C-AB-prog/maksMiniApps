// api/team/list.js
import { ensureSchema } from '../_db.js';
import { getTgId, getOrCreateUserId, getUserTeams } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'GET') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok:false, error:'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const teams = await getUserTeams(userId);
  res.json({
    ok: true,
    teams: teams.map(t => ({
      id: t.id,
      name: t.name,
      is_owner: t.owner_id === userId
    }))
  });
}
