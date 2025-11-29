// api/team/rename.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'POST') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok:false, error:'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const teamId = Number(req.body?.team_id || req.query?.team_id);
  if (!teamId) return res.status(400).json({ ok:false, error:'team_id required' });

  const name = (req.body?.name || '').toString().trim().slice(0, 64);
  if (!name) return res.status(400).json({ ok:false, error:'name required' });

  // проверяем, что пользователь состоит в команде
  const m = await q(
    `SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId],
  );
  if (!m.rows.length) return res.status(403).json({ ok:false, error:'forbidden' });

  await q(`UPDATE teams SET name = $1 WHERE id = $2`, [name, teamId]);

  res.json({ ok:true, team_id: teamId, name });
}
