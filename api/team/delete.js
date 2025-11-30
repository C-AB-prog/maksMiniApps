// api/team/delete.js
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

async function dbQuery(text, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res.rows;
  } finally {
    client.release();
  }
}

async function dbOne(text, params = []) {
  const rows = await dbQuery(text, params);
  return rows[0] || null;
}

async function getOrCreateUser(tgId) {
  if (!tgId) return null;
  const existing = await dbOne('SELECT id FROM users WHERE tg_id = $1', [tgId]);
  if (existing) return existing.id;
  const created = await dbOne(
    'INSERT INTO users (tg_id) VALUES ($1) ON CONFLICT (tg_id) DO UPDATE SET tg_id = EXCLUDED.tg_id RETURNING id',
    [tgId]
  );
  return created?.id || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'object' && req.body !== null
      ? req.body
      : JSON.parse(req.body || '{}');

    const tgId =
      (req.headers['x-tg-id'] || '').toString() ||
      (body.tg_id || '').toString();

    const teamId = Number(body.team_id || body.id || 0);
    if (!teamId) {
      return res.status(400).json({ ok: false, error: 'team_id_required' });
    }

    const userId = await getOrCreateUser(tgId);
    if (!userId) {
      return res.status(403).json({ ok: false, error: 'no_user' });
    }

    const team = await dbOne(
      'SELECT id, owner_user_id FROM teams WHERE id = $1',
      [teamId]
    );
    if (!team) {
      return res.status(404).json({ ok: false, error: 'team_not_found' });
    }

    if (String(team.owner_user_id) !== String(userId)) {
      return res.status(403).json({ ok: false, error: 'not_owner' });
    }

    await dbQuery('DELETE FROM teams WHERE id = $1', [teamId]);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[team/delete] error', e);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
