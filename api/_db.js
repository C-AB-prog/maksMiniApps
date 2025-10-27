import { Pool } from 'pg';

const CONN =
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!CONN) {
  throw new Error('No POSTGRES_URL / DATABASE_URL in env');
}

export const pool = new Pool({
  connectionString: CONN,
  ssl: { rejectUnauthorized: false },
});

export async function q(text, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function ensureSchema() {
  // создаём таблицы, если вдруг их нет (защита от «холодного старта»)
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      tg_id BIGINT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS focuses (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS tasks (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      due_ts BIGINT NULL,
      is_done BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_user   ON tasks(user_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_due_ts ON tasks(due_ts);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_focuses_user ON focuses(user_id);`);
}
