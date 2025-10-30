// api/chat.js (или api/chat/index.js)
const { Pool } = require('pg');
const OpenAI = require('openai');

/** ---------- PG pool (reuse между вызовами) ---------- */
const pool = global.__POOL__ || new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined
});
global.__POOL__ = pool;

/** ---------- Init schema один раз ---------- */
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

/** ---------- утилиты ---------- */
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

/** ---------- OpenAI (опционально) ---------- */
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

/** ---------- handler ---------- */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  try {
    await ensureSchema();
    req.body = await readJson(req);

    const tgId = parseTgId(req);
    if (!tgId) return json(res, 400, { error: 'TG_ID_REQUIRED' });

    const user = await getOrCreateUser(tgId);
    const message = (req.body?.message || '').toString().trim();
    if (!message) return json(res, 400, { error: 'EMPTY_MESSAGE' });

    // 1) сохраняем вопрос
    await pool.query(
      'INSERT INTO chat_messages (user_id, role, content) VALUES ($1,$2,$3)',
      [user.id, 'user', message]
    );

    // 2) контекст (последние 15)
    const { rows } = await pool.query(
      `SELECT role, content FROM chat_messages WHERE user_id=$1
       ORDER BY created_at DESC LIMIT 15`, [user.id]
    );
    const history = rows.reverse();

    // 3) ответ ассистента
    let answer = '';
    if (openai) {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 600,
        messages: [
          { role: 'system', content: 'Ты дружелюбный русскоязычный ассистент мини-приложения.' },
          ...history.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: message }
        ]
      });
      answer = completion.choices?.[0]?.message?.content?.trim() || 'Готово.';
    } else {
      answer = 'История сохранена (без OpenAI).';
    }

    // 4) сохраняем ответ
    await pool.query(
      'INSERT INTO chat_messages (user_id, role, content) VALUES ($1,$2,$3)',
      [user.id, 'assistant', answer]
    );

    return json(res, 200, { ok: true, reply: answer });
  } catch (e) {
    console.error('chat_error', e);
    return json(res, 500, { error: 'CHAT_FAILED' });
  }
};
