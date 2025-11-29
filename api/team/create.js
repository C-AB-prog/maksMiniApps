// api/team/create.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId, randomToken } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'POST') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const name = ((req.body?.name) || '').toString().trim().slice(0, 80) || `Команда ${tgId}`;
  const token = randomToken(32);

  const t = await q(
    `INSERT INTO teams(name, join_token)
     VALUES ($1, $2)
     RETURNING id, name, join_token`,
    [name, token]
  );
  const team = t.rows[0];

  await q(
    `INSERT INTO team_members(team_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [team.id, userId]
  );

  res.json({
    ok: true,
    team: {
      id: team.id,
      name: team.name,
      join_code: team.join_token,
    },
  });
}
