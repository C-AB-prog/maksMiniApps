// api/team/members.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'GET') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  let teamId = Number(req.query?.team_id);

  if (!teamId) {
    // если team_id не передали — берём первую команду пользователя
    const r = await q(
      `SELECT team_id
       FROM team_members
       WHERE user_id = $1
       ORDER BY joined_at ASC
       LIMIT 1`,
      [userId]
    );
    if (!r.rows.length) {
      return res.json({ ok: true, team_id: null, members: [] });
    }
    teamId = r.rows[0].team_id;
  } else {
    // проверяем, что пользователь состоит в этой команде
    const m = await q(
      `SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, userId]
    );
    if (!m.rows.length) {
      return res.status(403).json({ ok: false, error: 'not in team' });
    }
  }

  const members = await q(
    `SELECT u.tg_id, u.username, u.first_name, u.last_name
     FROM team_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.team_id = $1
     ORDER BY u.tg_id`,
    [teamId]
  );

  res.json({
    ok: true,
    team_id: teamId,
    members: members.rows,
  });
}
