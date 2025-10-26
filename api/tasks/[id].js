// /api/tasks/[id].js
exports.config = { runtime: 'nodejs20.x' };

const { sendJSON, readJSON, getOrCreateUser } = require('../_utils');
const { pool, ensureSchema, upsertUser } = require('../_db');

function getIdFromUrl(url) {
  const u = new URL(url, 'http://x');
  const parts = u.pathname.split('/'); // /api/tasks/123
  const raw = parts[parts.length - 1];
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

function parseISOorNull(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) return null;
  return d.toISOString();
}

module.exports = async (req, res) => {
  try {
    const id = getIdFromUrl(req.url);
    if (!id) return sendJSON(res, 400, { error: 'BAD_ID' });

    const { user } = getOrCreateUser(req, res);
    const tz = (new URL(req.url, 'http://x').searchParams.get('tz')) || 'UTC';

    await ensureSchema();
    await upsertUser(user, tz);

    if (req.method === 'PUT') {
      const b = await readJSON(req);

      // поддержка простого тога done
      if (typeof b.done === 'boolean') {
        await pool.query(
          `update tasks set done=$1 where id=$2 and user_id=$3`,
          [b.done, id, user.id]
        );
        return sendJSON(res, 200, { ok: true });
      }

      // поддержка обновления полей (если понадобится из UI позже)
      const title = b.title != null ? String(b.title).trim() : null;
      const scope = b.scope && ['today','week','backlog'].includes(b.scope) ? b.scope : null;
      const due_at = parseISOorNull(b.due_at);
      const remind_at = parseISOorNull(b.remind_at);
      const priority = Number.isFinite(+b.priority) ? +b.priority : null;
      const notes = b.notes != null ? String(b.notes).slice(0,2000) : null;

      await pool.query(
        `update tasks set
           title = coalesce($1, title),
           scope = coalesce($2, scope),
           due_at = coalesce($3, due_at),
           remind_at = coalesce($4, remind_at),
           priority = coalesce($5, priority),
           notes = coalesce($6, notes)
         where id=$7 and user_id=$8`,
        [title, scope, due_at, remind_at, priority, notes, id, user.id]
      );
      return sendJSON(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      await pool.query(`delete from tasks where id=$1 and user_id=$2`, [id, user.id]);
      return sendJSON(res, 200, { ok: true });
    }

    res.setHeader('Allow', 'PUT, DELETE');
    return sendJSON(res, 405, { error: 'Method Not Allowed' });
  } catch (e) {
    return sendJSON(res, 500, { error: e.message || String(e) });
  }
};
