// api/team/list.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });

  const userId = await getOrCreateUserId(tgId);

  // owner = тот, кто первый вступил (самый ранний joined_at)
  const r = await q(
    `
    SELECT
      t.id,
      t.name,
      t.join_code,
      t.created_at,
      (
        SELECT m2.user_id
        FROM team_members m2
        WHERE m2.team_id = t.id
        ORDER BY m2.joined_at ASC
        LIMIT 1
      ) AS owner_user_id
    FROM teams t
    JOIN team_members m ON m.team_id = t.id
    WHERE m.user_id = $1
    ORDER BY t.created_at DESC
    `,
    [userId]
  );

  const teams = r.rows.map(x => ({
    id: Number(x.id),
    name: x.name,
    join_code: x.join_code,
    is_owner: Number(x.owner_user_id) === Number(userId)
  }));

  return res.json({ ok: true, teams });
}
