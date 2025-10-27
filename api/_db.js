// /api/_db.js
import pg from "pg";

const { Pool } = pg;

// Нужна ТОЛЬКО одна строка подключения
const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  throw new Error("POSTGRES_URL is not set");
}

export const pool = new Pool({
  connectionString: POSTGRES_URL,
  // на серверлес это безопаснее
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// универсальный helper
export async function q(text, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

// Авточинилка схемы
export async function ensureSchema() {
  // users с tg_id
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      tg_id BIGINT UNIQUE,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // на случай старой таблицы без tg_id
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_id BIGINT;`);
  await q(`ALTER TABLE users ADD CONSTRAINT IF NOT EXISTS users_tg_id_key UNIQUE(tg_id);`);

  // focus – одна запись на пользователя
  await q(`
    CREATE TABLE IF NOT EXISTS focus (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      text TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // tasks
  await q(`
    CREATE TABLE IF NOT EXISTS tasks (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      scope TEXT DEFAULT 'today',
      due_at TIMESTAMPTZ NULL,
      done BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // индексы
  await q(`CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id);`);
  await q(`CREATE INDEX IF NOT EXISTS tasks_user_done_idx ON tasks(user_id, done);`);
}
