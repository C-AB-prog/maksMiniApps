// api/tasks/index.js (или api/tasks.js)
const { Pool } = require('pg');

const pool = global.__POOL__ || new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined
});
global.__POOL__ = pool;

let schemaReady = global.__TASKS_SCHEMA_READY__ || false;
async function ensureSchema() {
  if (schemaReady) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY,
      tg_id BIGINT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tasks(
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      due_at TIMESTAMPTZ,
      done BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id);
  `;
  await pool.query(sql);
  schemaReady = true;
  global.__TASKS_SCHEMA_READY__ = true;
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
      const { rows } = await pool.query(
        `SELECT id, title, due_at, done, created_at
         FROM tasks WHERE user_id=$1
         ORDER BY created_at DESC`, [user.id]
      );
      return json(res, 200, { ok: true, items: rows });
    }

    if (req.method === 'POST') {
      req.body = await readJson(req);
      const tgId = parseTgId(req);
      if (!tgId) return json(res, 400, { error: 'TG_ID_REQUIRED' });
      const user = await getOrCreateUser(tgId);

      const title = (req.body?.title || '').toString().trim();
      const due_at = req.body?.due_at ? new Date(req.body.due_at) : null;
      if (!title) return json(res, 400, { error: 'TITLE_REQUIRED' });

      const { rows } = await pool.query(
        `INSERT INTO tasks (user_id, title, due_at)
         VALUES ($1,$2,$3) RETURNING id, title, due_at, done, created_at`,
        [user.id, title, due_at]
      );
      return json(res, 200, { ok: true, item: rows[0] });
    }

    if (req.method === 'PATCH') {
      req.body = await readJson(req);
      const tgId = parseTgId(req);
      if (!tgId) return json(res, 400, { error: 'TG_ID_REQUIRED' });
      const user = await getOrCreateUser(tgId);

      const id = Number(req.body?.id);
      const done = !!req.body?.done;
      if (!id) return json(res, 400, { error: 'ID_REQUIRED' });

      const { rows } = await pool.query(
        `UPDATE tasks SET done=$1 WHERE id=$2 AND user_id=$3
         RETURNING id, title, due_at, done, created_at`,
        [done, id, user.id]
      );
      if (!rows.length) return json(res, 404, { error: 'NOT_FOUND' });
      return json(res, 200, { ok: true, item: rows[0] });
    }

    if (req.method === 'DELETE') {
      req.body = await readJson(req);
      const tgId = parseTgId(req);
      if (!tgId) return json(res, 400, { error: 'TG_ID_REQUIRED' });
      const user = await getOrCreateUser(tgId);

      const id = Number(req.body?.id);
      if (!id) return json(res, 400, { error: 'ID_REQUIRED' });
      await pool.query(`DELETE FROM tasks WHERE id=$1 AND user_id=$2`, [id, user.id]);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    console.error('tasks_error', e);
    return json(res, 500, { error: 'TASKS_FAILED' });
  }
};
