// /api/focus.js
exports.config = { runtime: 'nodejs20.x' };

const { sendJSON, readJSON, getOrCreateUser } = require('./_utils');
const { pool, ensureSchema, upsertUser } = require('./_db');

module.exports = async (req, res) => {
  try {
    const { user } = getOrCreateUser(req, res);
    const tz = (new URL(req.url, 'http://x').searchParams.get('tz')) || 'UTC';

    await ensureSchema();
    await upsertUser(user, tz);

    if (req.method === 'GET') {
      const { rows } = await pool.query(
        `select text, updated_at from focus where user_id=$1`,
        [user.id]
      );
      if (!rows[0]) return sendJSON(res, 200, {});
      return sendJSON(res, 200, rows[0]);
    }

    if (req.method === 'PUT') {
      const b = await readJSON(req);
      const text = String(b.text || '').trim();
      if (!text) return sendJSON(res, 400, { error: 'TEXT_REQUIRED' });

      await pool.query(
        `insert into focus (user_id, text, updated_at)
         values ($1, $2, now())
         on conflict (user_id) do update set text=excluded.text, updated_at=now()`,
        [user.id, text]
      );
      return sendJSON(res, 200, { ok: true });
    }

    res.setHeader('Allow', 'GET, PUT');
    return sendJSON(res, 405, { error: 'Method Not Allowed' });
  } catch (e) {
    return sendJSON(res, 500, { error: e.message || String(e) });
  }
};
