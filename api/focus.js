// /api/focus.js
const { getUserFromReq, sendJSON } = require('./_utils');
const { pool, ensureSchema, upsertUser } = require('./_db');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

module.exports = async (req, res) => {
  try {
    if (!['GET','PUT'].includes(req.method)) {
      res.setHeader('Allow','GET, PUT');
      return sendJSON(res, 405, { error:'Method Not Allowed' });
    }

    const auth = getUserFromReq(req, BOT_TOKEN);
    if (!auth.ok) return sendJSON(res, auth.status, { error: auth.error, reason: auth.reason });

    await ensureSchema(); await upsertUser(auth.user);

    if (req.method === 'GET') {
      const { rows } = await pool.query(`SELECT text, updated_at FROM focus WHERE user_id=$1`, [auth.user.id]);
      const row = rows[0] || { text:'', updated_at:null };
      return sendJSON(res, 200, row);
    }

    // PUT
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const text = String(body.text || '').slice(0, 2000);

    const { rows } = await pool.query(
      `INSERT INTO focus (user_id, text, updated_at)
       VALUES ($1,$2, now())
       ON CONFLICT (user_id) DO UPDATE SET text=EXCLUDED.text, updated_at=now()
       RETURNING text, updated_at`,
      [auth.user.id, text]
    );
    return sendJSON(res, 200, rows[0]);

  } catch (e) {
    return sendJSON(res, 500, { error: e.message });
  }
};
