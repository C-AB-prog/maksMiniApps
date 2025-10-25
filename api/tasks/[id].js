const { getUserFromReq, sendJSON } = require('../_utils');
const { pool, ensureSchema, upsertUser } = require('../_db');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

module.exports = async (req, res) => {
  try {
    const idMatch = req.url.match(/\/api\/tasks\/(\d+)/);
    const taskId = idMatch ? Number(idMatch[1]) : null;
    if (!taskId) return sendJSON(res, 400, { error: 'BAD_ID' });

    if (!['PUT','DELETE'].includes(req.method)) {
      res.setHeader('Allow', 'PUT, DELETE');
      return sendJSON(res, 405, { error: 'Method Not Allowed' });
    }

    const auth = getUserFromReq(req, BOT_TOKEN);
    if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error });

    await ensureSchema();
    await upsertUser(auth.user);

    if (req.method === 'PUT') {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');

      const fields = [];
      const params = [];
      let p = 1;

      if (typeof body.done === 'boolean'){ fields.push(`done=$${p++}`); params.push(body.done); }
      if (typeof body.title === 'string'){ fields.push(`title=$${p++}`); params.push(String(body.title).slice(0,500)); }
      if (typeof body.scope === 'string' && ['today','week','backlog'].includes(body.scope)){
        fields.push(`scope=$${p++}`); params.push(body.scope);
      }
      if (body.due_at !== undefined){
        fields.push(`due_at=$${p++}`); params.push(body.due_at ? new Date(body.due_at) : null);
      }

      if (!fields.length) return sendJSON(res, 400, { error: 'NO_FIELDS' });

      params.push(auth.user.id); // $p
      params.push(taskId);       // $p+1

      const { rows } = await pool.query(
        `UPDATE tasks
            SET ${fields.join(', ')}
          WHERE user_id=$${p++} AND id=$${p}
          RETURNING id, title, scope, done, due_at, created_at`,
        params
      );
      if (!rows[0]) return sendJSON(res, 404, { error: 'NOT_FOUND' });
      return sendJSON(res, 200, rows[0]);
    }

    if (req.method === 'DELETE') {
      const { rowCount } = await pool.query(
        `DELETE FROM tasks WHERE user_id=$1 AND id=$2`,
        [auth.user.id, taskId]
      );
      if (!rowCount) return sendJSON(res, 404, { error: 'NOT_FOUND' });
      res.statusCode = 204; res.end();
    }

  } catch (e) {
    return sendJSON(res, 500, { error: e.message });
  }
};
