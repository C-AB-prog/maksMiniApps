// api/team/create.js
import { ensureSchema } from '../_db.js';
import { getTgId, getOrCreateUserId, createTeam } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'POST') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok:false, error:'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const name = (req.body?.name || '').toString().trim() || `Команда ${tgId}`;
  const team = await createTeam(userId, tgId, name);

  res.json({
    ok: true,
    team: {
      id: team.id,
      name: team.name,
      join_token: team.join_token,
      is_owner: true
    }
  });
}
