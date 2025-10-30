const { Pool } = require('pg');

const pool = global.__POOL__ || new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined
});
global.__POOL__ = pool;

let schemaReady = global.__FOCUS_SCHEMA_READY__ || false;
async function ensureSchema() {
  if (schemaReady) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY,
      tg_id BIGINT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS focus(
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `;
  await pool.query(sql);
  schemaReady = true;
  global.__FOCUS_SCHEMA_READY__ = true;
}

function json(res, code, data) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
async function readJson(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}
function parseTgId(req) {
  const h = (req.headers['x-tg-id'] || '').toString().trim();
  if (h && /^\d+$/.test(h)) return h;
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('tg_id');
  if (q && /^\d+$/.test(q)) return q;
  const b = req.body?.tg_id ?? req.body?.tgId;
  if (b && /^\d+$/.test(String(b))) return String(b);
  return null;
}
async function getOrCreateUser(tgId) {
  const one = await pool.query('SELECT id FROM users WHERE tg_id=$1', [tgId]);
  if (one.rowCount) return one.rows[0];
  const ins = await pool.query('INSERT INTO users (tg_id) VALUES ($1) RETURNING id', [tgId]);
  return ins.rows[0];
}

module.exports = async (req, res) => {
  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const tgId = parseTgId(req);
      if (!tgId) return json(res, 400, { error: 'TG_ID_REQUIRED' });
      const user = await getOrCreateUser(tgId);

      const { rows } = await pool.query(`SELECT text, updated_at FROM focus WHERE user_id=$1`, [user.id]);
      return json(res, 200, { ok: true, text: rows[0]?.text || '' });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      req.body = await readJson(req);
      const tgId = parseTgId(req);
      if (!tgId) return json(res, 400, { error: 'TG_ID_REQUIRED' });
      const user = await getOrCreateUser(tgId);
      const text = (req.body?.text || '').toString();

      await pool.query(
        `INSERT INTO focus(user_id, text, updated_at)
         VALUES($1,$2,now())
         ON CONFLICT (user_id) DO UPDATE SET text=EXCLUDED.text, updated_at=now()`,
        [user.id, text]
      );
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    console.error('focus_error', e);
    return json(res, 500, { error: 'FOCUS_FAILED' });
  }
};
