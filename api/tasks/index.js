const { getUserFromReq, sendJSON } = require('../_utils');
const { pool, ensureSchema, upsertUser } = require('../_db');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return sendJSON(res, 405, { error: 'Method Not Allowed' });
    }

    const auth = getUserFromReq(req, BOT_TOKEN);
    if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error });

    await ensureSchema();
    await upsertUser(auth.user);

    if (req.method === 'GET') {
      const { rows } = await pool.query(
        `SELECT id, title, scope, done, due_at, created_at
           FROM tasks
          WHERE user_id=$1
          ORDER BY created_at DESC`,
        [auth.user.id]
      );
      return sendJSON(res, 200, { tasks: rows });
    }

    if (req.method === 'POST') {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');

      const title = String(body.title || '').trim().slice(0, 500);
      const scope = (['today','week','backlog'].includes(body.scope) ? body.scope : 'today');
      const due_at = body.due_at ? new Date(body.due_at) : null;

      if (!title) return sendJSON(res, 400, { error: 'TITLE_REQUIRED' });

      const params = [auth.user.id, title, scope, due_at];
      const { rows } = await pool.query(
        `INSERT INTO tasks (user_id, title, scope, due_at)
         VALUES ($1,$2,$3,$4)
         RETURNING id, title, scope, done, due_at, created_at`,
        params
      );
      return sendJSON(res, 200, rows[0]);
    }

  } catch (e) {
    return sendJSON(res, 500, { error: e.message });
  }
};
