// /api/focus.js
import { pool } from './_db';
import { getTgIdFromReq } from './_utils';

export default async function handler(req, res) {
  try {
    const tgId = getTgIdFromReq(req);
    if (tgId == null) return res.status(400).json({ ok: false, error: 'tg_id required' });

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
      const text = String(req.body?.text || '').trim();
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
      const id = req.body?.id;
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });
      await pool.query(
        `delete from focuses
          where id = $1::bigint and user_id = $2::bigint`,
        [String(id), tgId]
      );
      return res.json({ ok: true });
    }

    res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
