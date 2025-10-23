// api/focus.js
import sql, { getUserId } from './_utils/db.js';

export default async function handler(req, res) {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'UNAUTHORIZED' });

  if (req.method === 'GET') {
    const day = (req.query.day || '').slice(0, 10);
    if (!day) return res.status(400).json({ error: 'day is required (YYYY-MM-DD)' });
    try {
      const { rows } = await sql`
        select text from ga_focus
        where tg_user_id = ${uid} and day = ${day}::date
        limit 1
      `;
      res.status(200).json({ text: rows[0]?.text || '' });
    } catch (e) {
      res.status(500).json({ error: 'DB_ERROR', message: e.message });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const { day, text } = req.body || {};
      if (!day || !text) return res.status(400).json({ error: 'day & text required' });
      await sql`
        insert into ga_focus (tg_user_id, day, text)
        values (${uid}, ${day}::date, ${text})
        on conflict (tg_user_id, day) do update set text = ${text}, updated_at = now()
      `;
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'DB_ERROR', message: e.message });
    }
    return;
  }

  res.setHeader('Allow', 'GET, PUT');
  res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
}
