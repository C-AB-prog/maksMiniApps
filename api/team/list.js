// api/team/list.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'GET') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) {
    return res.status(400).json({ ok: false, error: 'tg_id required' });
  }
  const userId = await getOrCreateUserId(tgId);

  // ВАЖНО: берём ВСЕ команды, где пользователь есть в team_members
  const r = await q(
    `
    SELECT t.id,
           t.name,
           t.join_token AS join_code
    FROM teams t
    JOIN team_members m ON m.team_id = t.id
    WHERE m.user_id = $1
    ORDER BY t.id ASC
    `,
    [userId],
  );

  res.json({
    ok: true,
    teams: r.rows,
  });
}
