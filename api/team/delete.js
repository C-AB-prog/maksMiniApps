// api/team/delete.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok:false, error:'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const teamId = Number(req.body?.team_id || req.query?.team_id);
  if (!teamId) return res.status(400).json({ ok:false, error:'team_id required' });

  // пользователь должен быть участником команды
  const m = await q(
    `SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId],
  );
  if (!m.rows.length) return res.status(403).json({ ok:false, error:'forbidden' });

  // Удаляем команду — по FK у тебя:
  //  - team_members удалятся (ON DELETE CASCADE)
  //  - tasks.team_id станет NULL (ON DELETE SET NULL)
  await q(`DELETE FROM teams WHERE id = $1`, [teamId]);

  res.json({ ok:true });
}
