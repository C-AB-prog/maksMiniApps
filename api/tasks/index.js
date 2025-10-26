// /api/tasks/index.js
exports.config = { runtime: 'nodejs20.x' };

const { sendJSON, readJSON, getOrCreateUser } = require('../_utils');
const { pool, ensureSchema, upsertUser } = require('../_db');

function parseISOorNull(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) return null;
  return d.toISOString();
}

module.exports = async (req, res) => {
  try {
    const { user, source } = getOrCreateUser(req, res);
    const tz = (new URL(req.url, 'http://x').searchParams.get('tz')) || 'UTC';

    await ensureSchema();
    await upsertUser(user, tz);

    if (req.method === 'GET') {
      const { rows } = await pool.query(
        `select id, title, done, scope, priority,
                to_char(due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as due_at
           from tasks
          where user_id = $1
          order by created_at desc
          limit 200`,
        [user.id]
      );
      return sendJSON(res, 200, { tasks: rows, source });
    }

    if (req.method === 'POST') {
      const b = await readJSON(req);
      const title = String(b.title || '').trim();
      if (!title) return sendJSON(res, 400, { error: 'TITLE_REQUIRED' });

      const scope = ['today', 'week', 'backlog'].includes(b.scope) ? b.scope : 'today';
      const due_at = parseISOorNull(b.due_at);
      const remind_at = parseISOorNull(b.remind_at);
      const priority = Number.isFinite(+b.priority) ? +b.priority : 0;
      const notes = b.notes ? String(b.notes).slice(0, 2000) : null;

      const { rows } = await pool.query(
        `insert into tasks (user_id, title, scope, due_at, remind_at, priority, notes)
         values ($1,$2,$3,$4,$5,$6,$7)
         returning id`,
        [user.id, title, scope, due_at, remind_at, priority, notes]
      );
      return sendJSON(res, 200, { ok: true, id: rows[0].id });
    }

    res.setHeader('Allow', 'GET, POST');
    return sendJSON(res, 405, { error: 'Method Not Allowed' });
  } catch (e) {
    // максимально ясный ответ для фронта/логов
    return sendJSON(res, 500, { error: e.message || String(e) });
  }
};
