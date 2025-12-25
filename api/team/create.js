// api/team/create.js (ESM)
import crypto from 'crypto';

import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

function makeJoinToken() {
  return crypto.randomBytes(8).toString('hex'); // 16 chars
}

export default async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const tg_id = getTgId(req);
    if (!tg_id) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const user_id = await getOrCreateUserId(tg_id);

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const name = String(body?.name || '').trim();

    if (!name) {
      return res.status(400).json({ ok: false, error: 'Team name required' });
    }

    // generate unique join_token (retry a few times)
    let join_token = makeJoinToken();
    for (let i = 0; i < 5; i++) {
      const exists = await q(`SELECT 1 FROM teams WHERE join_token=$1`, [join_token]);
      if (exists.rows.length === 0) break;
      join_token = makeJoinToken();
    }

    const created = await q(
      `INSERT INTO teams (name, join_token, created_by_user_id)
       VALUES ($1,$2,$3)
       RETURNING id, name, join_token, created_by_user_id, created_at`,
      [name, join_token, user_id]
    );

    const team = created.rows[0];

    // add creator as member
    await q(
      `INSERT INTO team_members (team_id, user_id)
       VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [team.id, user_id]
    );

    return res.status(200).json({ ok: true, team });
  } catch (e) {
    console.error('team/create error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'Server error' });
  }
}
