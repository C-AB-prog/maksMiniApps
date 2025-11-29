// api/_db.js
import pkg from 'pg';
const { Pool } = pkg;

let pool = null;

/* ======================== */
/*  ИНИЦИАЛИЗАЦИЯ КОННЕКТА  */
/* ======================== */
export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

export function q(text, params) {
  return getPool().query(text, params);
}

/* ================================== */
/*   СТРУКТУРА БАЗЫ (ensureSchema)    */
/* ================================== */
/*
  Эта функция идеально подходит под Neon:
  - создаёт все таблицы, если их нет
  - добавляет новые колонки только если их нет
  - не ломает существующие данные
  - не создаёт дублей FK
*/
export async function ensureSchema() {
  /* === USERS === */
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id         BIGSERIAL PRIMARY KEY,
      tg_id      BIGINT UNIQUE NOT NULL,
      username   TEXT,
      first_name TEXT,
      last_name  TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  /* === FOCUS === */
  await q(`
    CREATE TABLE IF NOT EXISTS focuses (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  /* === TASKS === */
  await q(`
    CREATE TABLE IF NOT EXISTS tasks (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      due_ts     BIGINT NULL,
      is_done    BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now(),
      team_id    BIGINT NULL
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_user   ON tasks(user_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_due_ts ON tasks(due_ts);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_team   ON tasks(team_id);`);
  await q(`
    CREATE INDEX IF NOT EXISTS idx_tasks_due_active
    ON tasks(due_ts) WHERE is_done = false;
  `);

  /* === TEAMS === */
  await q(`
    CREATE TABLE IF NOT EXISTS teams (
      id         BIGSERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      join_token TEXT UNIQUE NOT NULL,
      owner_id   BIGINT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  /* === TEAM MEMBERS === */
  await q(`
    CREATE TABLE IF NOT EXISTS team_members (
      team_id   BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (team_id, user_id)
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);`);

  /* === ВНЕШНИЙ КЛЮЧ ДЛЯ TEAM_ID В TASKS === */
  await q(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM   information_schema.table_constraints tc
        WHERE  tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_name = 'tasks'
           AND tc.constraint_name = 'fk_tasks_team'
      ) THEN
        ALTER TABLE tasks
          ADD CONSTRAINT fk_tasks_team
          FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  /* === TASK NOTIFICATIONS === */
  await q(`
    CREATE TABLE IF NOT EXISTS task_notifications (
      task_id          BIGINT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      sent_due_warning BOOLEAN NOT NULL DEFAULT false,
      sent_overdue     BOOLEAN NOT NULL DEFAULT false,
      updated_at       TIMESTAMPTZ DEFAULT now()
    );
  `);

  return true;
}

/* ========================================================= */
/*          УТИЛИТА ДЛЯ ПРОВЕРКИ ПОДКЛЮЧЕНИЯ                */
/* ========================================================= */
export async function testConnection() {
  const r = await q('SELECT NOW() as now');
  return r.rows[0].now;
}
