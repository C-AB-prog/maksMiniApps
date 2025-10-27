// /api/tasks.js
import { Pool } from 'pg';

const pool = global.pgPool ?? new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL,
  ssl: { rejectUnauthorized: false },
});
if (!global.pgPool) global.pgPool = pool;

export default async function handler(req, res) {
  try {
    const tgId = String(
      req.headers['x-tg-id'] ||
      req.body?.tg_id ||
      req.query?.tg_id || ''
    ).trim();

    if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });

    if (req.method === 'GET') {
      const q = await pool.query(
        `select id, title, due_ts, done
           from tasks
          where user_id = $1::bigint
          order by due_ts nulls last, id desc
          limit 200`,
        [tgId]
      );
      return res.json({ ok: true, items: q.rows });
    }

    if (req.method === 'POST') {
      const { title, due_ts } = req.body || {};
      if (!title) return res.status(400).json({ ok: false, error: 'title required' });

      const q = await pool.query(
        `insert into tasks(user_id, title, due_ts)
         values ($1::bigint, $2, $3)
         returning id, title, due_ts, done`,
        [tgId, title, due_ts ?? null]
      );
      return res.json({ ok: true, item: q.rows[0] });
    }

    if (req.method === 'PATCH') {
      const { id, done } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });

      const q = await pool.query(
        `update tasks
            set done = coalesce($3::bool, done)
          where id = $1::bigint
            and user_id = $2::bigint
        returning id, title, due_ts, done`,
        [String(id), tgId, done]
      );
      if (!q.rowCount) return res.status(404).json({ ok: false, error: 'not found' });
      return res.json({ ok: true, item: q.rows[0] });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });

      await pool.query(
        `delete from tasks
          where id = $1::bigint
            and user_id = $2::bigint`,
        [String(id), tgId]
      );
      return res.json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
