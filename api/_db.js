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
  // базовые таблицы
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      tg_id BIGINT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // новые поля для отображения участников команды
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username   TEXT;`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name  TEXT;`);

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
      created_at TIMESTAMPTZ DEFAULT now(),
      team_id BIGINT NULL
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_user   ON tasks(user_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_due_ts ON tasks(due_ts);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_focuses_user ON focuses(user_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_due_active ON tasks(due_ts) WHERE is_done = false;`);

  // команды
  await q(`
    CREATE TABLE IF NOT EXISTS teams (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      join_token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS team_members (
      team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (team_id, user_id)
    );
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);`);

  // FK для tasks.team_id (если ещё нет)
  await q(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tasks' AND constraint_name='fk_tasks_team'
      ) THEN
        ALTER TABLE tasks
          ADD CONSTRAINT fk_tasks_team
          FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  // фиксация отправленных напоминаний
  await q(`
    CREATE TABLE IF NOT EXISTS task_notifications (
      task_id BIGINT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      sent_due_warning BOOLEAN NOT NULL DEFAULT false,
      sent_overdue BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}
