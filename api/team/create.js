// api/team/create.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

function genCode(len = 10) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без похожих символов
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });

  const userId = await getOrCreateUserId(tgId);

  const nameRaw = (req.body?.name || '').toString().trim();
  const name = (nameRaw || 'Команда').slice(0, 60);

  // генерим join_code + join_token так, чтобы не упасть на UNIQUE
  let join_code = '';
  let join_token = '';
  for (let i = 0; i < 6; i++) {
    join_code = genCode(10);
    join_token = genCode(22);
    const exists = await q(
      'SELECT 1 FROM teams WHERE join_code = $1 OR join_token = $2 LIMIT 1',
      [join_code, join_token]
    );
    if (!exists.rows.length) break;
  }
  if (!join_code || !join_token) {
    return res.status(500).json({ ok: false, error: 'cannot_generate_code' });
  }

  try {
    const ins = await q(
      `INSERT INTO teams (name, join_token, join_code)
       VALUES ($1, $2, $3)
       RETURNING id, name, join_code, join_token, created_at`,
      [name, join_token, join_code]
    );

    const team = ins.rows[0];

    // создатель = участник команды
    await q(
      `INSERT INTO team_members (team_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [team.id, userId]
    );

    return res.json({ ok: true, team });
  } catch (e) {
    console.error('[team/create] error:', e);
    return res.status(200).json({ ok: false, error: 'create_failed' });
  }
}
