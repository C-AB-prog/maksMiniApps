// api/team/delete.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'POST') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok:false, error:'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const teamId = Number(req.body?.team_id);
  if (!teamId) return res.status(400).json({ ok:false, error:'team_id required' });

  // проверяем, что пользователь в этой команде
  const m = await q(
    `SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId],
  );
  if (!m.rows.length) {
    return res.status(403).json({ ok:false, error:'not in team' });
  }

  // удаляем саму команду — team_members удалятся каскадно,
  // у tasks team_id обнулится (ON DELETE SET NULL)
  await q(
    `DELETE FROM teams WHERE id = $1`,
    [teamId],
  );

  res.json({ ok:true, team_id: teamId });
}
