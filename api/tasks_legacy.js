// api/tasks.js
import sql, { getUserId } from './_utils/db.js';

export default async function handler(req, res) {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'UNAUTHORIZED' });

  if (req.method === 'GET') {
    const list = String(req.query.list || 'today');
    try {
      const { rows } = await sql`
        select id, title, list, due_date, due_time, is_done
        from ga_tasks
        where tg_user_id = ${uid} and list = ${list}
        order by id desc
        limit 50
      `;
      res.status(200).json({ items: rows });
    } catch (e) {
      res.status(500).json({ error: 'DB_ERROR', message: e.message });
    }
    return;
  }

  if (req.method === 'POST') {
    const { title, list='today', due_date=null, due_time=null } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title required' });
    try {
      const { rows } = await sql`
        insert into ga_tasks (tg_user_id, title, list, due_date, due_time)
        values (${uid}, ${title}, ${list}, ${due_date}, ${due_time})
        returning id, title, list, due_date, due_time, is_done
      `;
      res.status(200).json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: 'DB_ERROR', message: e.message });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
}
