const { Pool } = require('pg');

const pool = global.__POOL__ || new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined
});
global.__POOL__ = pool;

let schemaReady = global.__SCHEMA_READY__ || false;
async function ensureSchema() {
  if (schemaReady) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY,
      tg_id BIGINT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS chat_messages(
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS chat_messages_user_id_created_at_idx
      ON chat_messages(user_id, created_at DESC);
  `;
  await pool.query(sql);
  schemaReady = true;
  global.__SCHEMA_READY__ = true;
}

function json(res, code, data) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
function parseTgId(req) {
  const h = (req.headers['x-tg-id'] || '').toString().trim();
  if (h && /^\d+$/.test(h)) return h;
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('tg_id');
  if (q && /^\d+$/.test(q)) return q;
  return null;
}
async function getOrCreateUser(tgId) {
  const one = await pool.query('SELECT id FROM users WHERE tg_id=$1', [tgId]);
  if (one.rowCount) return one.rows[0];
  const ins = await pool.query('INSERT INTO users (tg_id) VALUES ($1) RETURNING id', [tgId]);
  return ins.rows[0];
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  try {
    await ensureSchema();

    const tgId = parseTgId(req);
    if (!tgId) return json(res, 400, { error: 'TG_ID_REQUIRED' });

    const user = await getOrCreateUser(tgId);
    const { rows } = await pool.query(
      `SELECT role, content, created_at
       FROM chat_messages
       WHERE user_id=$1
       ORDER BY created_at ASC
       LIMIT 200`, [user.id]
    );
    return json(res, 200, { ok: true, messages: rows });
  } catch (e) {
    console.error('history_error', e);
    return json(res, 500, { error: 'HISTORY_FAILED' });
  }
};
