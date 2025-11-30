// api/team/delete.js
// Расформировать команду (любой участник может удалить)

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function ensureUser(client, tgId) {
  const idNum = Number(tgId);
  if (!idNum) throw new Error('tg_id required');

  const r = await client.query(
    'SELECT id FROM users WHERE tg_id = $1',
    [idNum]
  );
  if (r.rows[0]) return r.rows[0].id;

  const ins = await client.query(
    'INSERT INTO users (tg_id) VALUES ($1) RETURNING id',
    [idNum]
  );
  return ins.rows[0].id;
}

function readJson(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const tgIdHeader = (req.headers['x-tg-id'] || '').toString();
    const tgId = tgIdHeader || '';
    if (!tgId) {
      return res.status(400).json({ ok: false, error: 'tg_id required' });
    }

    const body = await readJson(req);
    const teamId = Number(body.team_id || 0);
    if (!teamId) {
      return res.status(400).json({ ok: false, error: 'team_id required' });
    }

    await withClient(async (client) => {
      const userId = await ensureUser(client, tgId);

      // проверяем, что пользователь вообще участвует в этой команде
      const member = await client.query(
        'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2',
        [teamId, userId]
      );
      if (!member.rows[0]) {
        throw new Error('not_in_team');
      }

      // удаляем команду; team_members и chat_tasks зависят через FK
      await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[team/delete] error', e);
    const msg = e.message || '';
    if (msg === 'not_in_team') {
      return res.status(403).json({ ok: false, error: 'not_in_team' });
    }
    return res.status(500).json({ ok: false, error: 'db_error' });
  }
}
