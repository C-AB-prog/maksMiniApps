// api/_utils/db.js
import { sql } from '@vercel/postgres';
import crypto from 'crypto';

/** ---------- TG init parsing ---------- */
export function parseTelegramUser(initData) {
  try {
    const p = new URLSearchParams(initData || '');
    const raw = p.get('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function verifyTelegramInit(initData, botToken) {
  if (!initData || !botToken) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') || '';
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return calc === hash;
}

/** ---------- DEV mode switches ---------- */
const allowUnsigned = () => process.env.ALLOW_UNSIGNED === '1';

/** ---------- DB bootstrap ---------- */
export async function ensureTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      username     TEXT,
      first_name   TEXT,
      last_name    TEXT,
      created_at   TIMESTAMP DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      list         TEXT NOT NULL CHECK (list IN ('today','week','backlog')),
      done         BOOLEAN NOT NULL DEFAULT FALSE,
      due_date     DATE,
      due_time     TIME,
      hint         TEXT,
      created_at   TIMESTAMP DEFAULT NOW(),
      updated_at   TIMESTAMP DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS focus (
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day        DATE NOT NULL,
      text       TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, day)
    );
  `;
}

/** ---------- Request guard ---------- */
export function requestIsSigned(initData, botToken) {
  if (allowUnsigned()) return true; // DEV override
  return verifyTelegramInit(initData, botToken);
}

export async function getOrCreateUser(initData) {
  const u = parseTelegramUser(initData);
  if (u && u.id) {
    await sql`
      INSERT INTO users (id, username, first_name, last_name)
      VALUES (${String(u.id)}, ${u.username || null}, ${u.first_name || null}, ${u.last_name || null})
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name;
    `;
    return { id: String(u.id), username: u.username || null };
  }
  // DEV fallback user
  if (allowUnsigned()) {
    const id = String(process.env.DEV_USER_ID || 'dev-user');
    await sql`INSERT INTO users (id, username) VALUES (${id}, 'dev') ON CONFLICT (id) DO NOTHING`;
    return { id, username: 'dev' };
  }
  return null;
}

/** ---------- helpers ---------- */
export function ok(data = {}) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
}
export function err(status, message) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } });
}
