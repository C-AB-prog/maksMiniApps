// api/_db.js
// Работа с Postgres (Neon) + схема

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

/**
 * Создаём / обновляем схему (таблицы, индексы).
 * Можно безопасно вызывать при каждом запросе (но лучше один раз при старте).
 */
export async function ensureSchema() {
  // USERS
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      tg_id BIGINT UNIQUE NOT NULL,
      username   TEXT,
      first_name TEXT,
      last_name  TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // FOCUSES
  await q(`
    CREATE TABLE IF NOT EXISTS focuses (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // TASKS
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

  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_user        ON tasks(user_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_due_ts      ON tasks(due_ts);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_focuses_user      ON focuses(user_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_due_active  ON tasks(due_ts) WHERE is_done = false;`);

  // TEAMS
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

  // FK tasks.team_id → teams.id (если ещё нет)
  await q(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'tasks'
          AND constraint_name = 'fk_tasks_team'
      ) THEN
        ALTER TABLE tasks
          ADD CONSTRAINT fk_tasks_team
          FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team_id);`);

  // TASK NOTIFICATIONS
  await q(`
    CREATE TABLE IF NOT EXISTS task_notifications (
      task_id BIGINT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      sent_due_warning  BOOLEAN NOT NULL DEFAULT false,
      sent_overdue      BOOLEAN NOT NULL DEFAULT false,
      updated_at        TIMESTAMPTZ DEFAULT now()
    );
  `);

  // CHATS: sessions
  await q(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user
    ON chat_sessions(user_id);
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated
    ON chat_sessions(user_id, updated_at DESC);
  `);

  // CHATS: messages
  await q(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_chat
    ON chat_messages(chat_id, created_at);
  `);
}

/**
 * Получить или создать user.id по tg_id
 */
export async function getOrCreateUserId(tgId) {
  if (!tgId) throw new Error('tgId required');

  const tgNum = Number(tgId);

  const found = await q(
    `SELECT id FROM users WHERE tg_id = $1`,
    [tgNum]
  );
  if (found.rows.length) return found.rows[0].id;

  const ins = await q(
    `INSERT INTO users(tg_id) VALUES ($1) RETURNING id`,
    [tgNum]
  );
  return ins.rows[0].id;
}
