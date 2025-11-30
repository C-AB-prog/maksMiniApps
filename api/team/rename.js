// api/team/rename.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'POST') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) {
    return res.status(400).json({ ok: false, error: 'tg_id required' });
  }
  const userId = await getOrCreateUserId(tgId);

  const teamId = Number(req.body?.team_id);
  if (!teamId) {
    return res.status(400).json({ ok: false, error: 'team_id required' });
  }

  const name = (req.body?.name || '').toString().trim().slice(0, 80);
  if (!name) {
    return res.status(400).json({ ok: false, error: 'name required' });
  }

  // только первый участник (создатель) может переименовать
  const own = await q(
    `
    SELECT user_id
    FROM team_members
    WHERE team_id = $1
    ORDER BY joined_at ASC
    LIMIT 1
    `,
    [teamId],
  );

  if (!own.rows.length || Number(own.rows[0].user_id) !== userId) {
    return res.status(403).json({ ok: false, error: 'only owner can rename' });
  }

  const u = await q(
    `
    UPDATE teams
    SET name = $1
    WHERE id = $2
    RETURNING id, name, join_token AS join_code
    `,
    [name, teamId],
  );

  if (!u.rows.length) {
    return res.status(404).json({ ok: false, error: 'team not found' });
  }

  res.json({ ok: true, team: u.rows[0] });
}
