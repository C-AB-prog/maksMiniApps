// api/_db.js (ESM)
// Единый модуль работы с БД для всех /api/*
//
// В проекте много роутов импортируют { q, ensureSchema, pool }.
// Раньше этот файл был в формате CommonJS и экспортировал только query(),
// из-за чего q был undefined → list/chat_sessions/tasks падали и фронт
// видел пустые списки, а /api/chat отвечал "Сейчас сервер БД недоступен...".

import pg from 'pg';

const { Pool } = pg;

let _pool;

function pickConnectionString() {
  // На Vercel + Neon/POSTGRES integration корректнее предпочесть pooled URL.
  // Если POSTGRES_URL не задан — используем DATABASE_URL/другие фолбэки.
  return (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_CONNECTION_STRING ||
    process.env.MANUAL_POSTGRES_URL
  );
}

export function getPool() {
  if (_pool) return _pool;

  const connectionString = pickConnectionString();
  if (!connectionString) {
    throw new Error(
      'Missing DB connection string. Set POSTGRES_URL (preferred) or DATABASE_URL in Vercel env.'
    );
  }

  _pool = new Pool({
    connectionString,
    // Neon/Vercel требуют SSL. rejectUnauthorized=false — стандартный вариант для serverless.
    ssl: { rejectUnauthorized: false },
    // В serverless лучше держать мало коннектов.
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  return _pool;
}

// Публичные экспорты, которые ждут роуты
export const pool = getPool();

export async function q(text, params = []) {
  return pool.query(text, params);
}

// Алиас для старых мест, если где-то ещё используется query()
export const query = q;

/**
 * Создаёт/обновляет схему БД (idempotent).
 * Важно: функция вызывается из многих роутов.
 */
export async function ensureSchema() {
  // USERS
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

  // FOCUSES
  await q(`
    CREATE TABLE IF NOT EXISTS focuses (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_focuses_user ON focuses(user_id);`);

  // TEAMS
  await q(`
    CREATE TABLE IF NOT EXISTS teams (
      id                 BIGSERIAL PRIMARY KEY,
      name               TEXT NOT NULL,
      join_token         TEXT UNIQUE NOT NULL,
      created_by_user_id BIGINT NULL,
      created_at         TIMESTAMPTZ DEFAULT now()
    );
  `);

  // FK for teams.creator
  await q(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'teams'
          AND tc.constraint_name = 'fk_teams_created_by'
      ) THEN
        ALTER TABLE teams
          ADD CONSTRAINT fk_teams_created_by
          FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_teams_created_by ON teams(created_by_user_id);`);

  // TEAM MEMBERS
  await q(`
    CREATE TABLE IF NOT EXISTS team_members (
      team_id   BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (team_id, user_id)
    );
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);`);

  // TASKS
  await q(`
    CREATE TABLE IF NOT EXISTS tasks (
      id                  BIGSERIAL PRIMARY KEY,
      user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title               TEXT NOT NULL,
      due_ts              BIGINT NULL,
      is_done             BOOLEAN NOT NULL DEFAULT false,
      created_at          TIMESTAMPTZ DEFAULT now(),
      team_id             BIGINT NULL,
      assigned_to_user_id BIGINT NULL
    );
  `);

  // FK tasks.team_id
  await q(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'tasks'
          AND tc.constraint_name = 'fk_tasks_team'
      ) THEN
        ALTER TABLE tasks
          ADD CONSTRAINT fk_tasks_team
          FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  // FK tasks.assigned_to_user_id
  await q(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'tasks'
          AND tc.constraint_name = 'fk_tasks_assigned_to'
      ) THEN
        ALTER TABLE tasks
          ADD CONSTRAINT fk_tasks_assigned_to
          FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_due_ts ON tasks(due_ts);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_due_active ON tasks(due_ts) WHERE is_done = false;`);
  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to_user_id);`);

  // TASK NOTIFICATIONS
  await q(`
    CREATE TABLE IF NOT EXISTS task_notifications (
      task_id          BIGINT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      sent_due_warning BOOLEAN NOT NULL DEFAULT false,
      sent_overdue     BOOLEAN NOT NULL DEFAULT false,
      updated_at       TIMESTAMPTZ DEFAULT now()
    );
  `);

  // CHATS
  await q(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated ON chat_sessions(user_id, updated_at DESC);`);

  await q(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id         BIGSERIAL PRIMARY KEY,
      chat_id    BIGINT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role       TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, created_at);`);
}

// Утилиты, которые используют некоторые роуты/бот
export async function getOrCreateUserByTg(tgUser) {
  if (!tgUser || !tgUser.id) throw new Error('Missing tg user data (tgUser.id).');

  const tg_id = Number(tgUser.id);
  const username = tgUser.username || null;
  const first_name = tgUser.first_name || null;
  const last_name = tgUser.last_name || null;

  const existing = await q(`SELECT * FROM users WHERE tg_id = $1`, [tg_id]);
  if (existing.rows.length) {
    await q(
      `UPDATE users SET username=$2, first_name=$3, last_name=$4 WHERE tg_id=$1`,
      [tg_id, username, first_name, last_name]
    );
    return existing.rows[0];
  }

  const created = await q(
    `INSERT INTO users (tg_id, username, first_name, last_name)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [tg_id, username, first_name, last_name]
  );

  return created.rows[0];
}

export async function getOrCreateUserIdByTgId(tg_id) {
  const tgIdNum = Number(tg_id);
  const res = await q(`SELECT id FROM users WHERE tg_id=$1`, [tgIdNum]);
  if (res.rows.length) return Number(res.rows[0].id);

  const created = await q(
    `INSERT INTO users (tg_id) VALUES ($1) RETURNING id`,
    [tgIdNum]
  );
  return Number(created.rows[0].id);
}
