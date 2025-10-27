// /api/debug.js
import { pool } from './_db';
import { getTgIdFromReq } from './_utils';

export default async function handler(req, res) {
  try {
    const what = String(req.query?.what || '').toLowerCase();

    if (what === 'ping') {
      return res.json({ ok: true, note: 'pong' });
    }

    if (what === 'who') {
      const id = getTgIdFromReq(req);
      return res.json({ ok: true, tg_id: id });
    }

    if (what === 'schema') {
      const x = await pool.query(`
        select table_name, column_name, data_type
        from information_schema.columns
        where table_schema = 'public'
          and table_name in ('tasks','focuses')
        order by table_name, ordinal_position
      `);
      return res.json({ ok: true, schema: x.rows });
    }

    return res.status(404).json({ ok: false, error: 'Not found', path: req.url });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
