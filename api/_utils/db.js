// api/_utils/db.js
import pg from 'pg';

const {
  POSTGRES_URL,
  DATABASE_URL,
} = process.env;

const conn = POSTGRES_URL || DATABASE_URL;
if (!conn) {
  console.warn('[db] No POSTGRES_URL / DATABASE_URL env var found');
}

const pool = new pg.Pool({
  connectionString: conn,
  max: 5,
  idleTimeoutMillis: 30_000,
});

export async function q(sql, params = []) {
  const c = await pool.connect();
  try {
    const res = await c.query(sql, params);
    return res.rows;
  } finally {
    c.release();
  }
}

// Унифицированное создание таблиц — одна точка истины
export async function ensureTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS focus (
      telegram_id TEXT PRIMARY KEY,
      text        TEXT NOT NULL DEFAULT ''
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          BIGSERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      text        TEXT NOT NULL,
      list        TEXT NOT NULL DEFAULT 'today',
      due_date    DATE DEFAULT NULL,
      due_time    TIME DEFAULT NULL,
      completed   BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // индексы для скорости и изоляции по пользователю
  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks (telegram_id);`);
}
