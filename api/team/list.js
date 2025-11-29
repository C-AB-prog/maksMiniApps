// api/team/list.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'GET') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const r = await q(
    `SELECT t.id, t.name, t.join_token
     FROM team_members m
     JOIN teams t ON t.id = m.team_id
     WHERE m.user_id = $1
     ORDER BY t.id ASC`,
    [userId]
  );

  res.json({
    ok: true,
    teams: r.rows.map(row => ({
      id: row.id,
      name: row.name,
      join_code: row.join_token,
    })),
  });
}
