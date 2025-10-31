// api/team/members.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'GET') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const r = await q(
    `SELECT m.team_id
     FROM team_members m
     WHERE m.user_id = $1
     LIMIT 1`,
    [userId]
  );

  if (!r.rows.length) {
    return res.json({ ok: true, team_id: null, members: [] });
  }

  const teamId = r.rows[0].team_id;
  const u = await q(
    `SELECT u.tg_id, u.username, u.first_name, u.last_name
     FROM team_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.team_id = $1
     ORDER BY u.tg_id`,
    [teamId]
  );

  res.json({ ok: true, team_id: teamId, members: u.rows });
}
