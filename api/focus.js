// /api/focus.js
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
        `select id, text, ts
           from focuses
          where user_id = $1::bigint
          order by ts desc
          limit 50`,
        [tgId]
      );
      return res.json({ ok: true, items: q.rows });
    }

    if (req.method === 'POST') {
      const { text } = req.body || {};
      if (!text) return res.status(400).json({ ok: false, error: 'text required' });

      const q = await pool.query(
        `insert into focuses(user_id, text)
         values ($1::bigint, $2)
         returning id, text, ts`,
        [tgId, text]
      );
      return res.json({ ok: true, item: q.rows[0] });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });

      await pool.query(
        `delete from focuses
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
