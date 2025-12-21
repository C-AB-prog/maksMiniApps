// api/_db.js
const { Pool } = require("pg");

let _pool;

/**
 * Берём connection string из переменных окружения:
 * - DATABASE_URL (стандарт для Vercel/Neon)
 * - POSTGRES_URL (иногда используют так)
 */
function getPool() {
  if (_pool) return _pool;

  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_CONNECTION_STRING;

  if (!connectionString) {
    throw new Error(
      "Missing DATABASE_URL/POSTGRES_URL env var. Set it in Vercel project settings."
    );
  }

  _pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  return _pool;
}

async function query(text, params) {
  const pool = getPool();
  return pool.query(text, params);
}

/**
 * Создаёт/обновляет схему БД (idempotent).
 * Важно: если у тебя уже есть дамп с DROP TABLE — просто накати дамп.
 * Но эта функция должна быть безопасной и совместимой с текущими изменениями.
 */
async function ensureSchema() {
  // USERS
  await query(`
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
  await query(`
    CREATE TABLE IF NOT EXISTS focuses (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_focuses_user ON focuses(user_id);`);

  // TEAMS
  await query(`
    CREATE TABLE IF NOT EXISTS teams (
      id                 BIGSERIAL PRIMARY KEY,
      name               TEXT NOT NULL,
      join_token         TEXT UNIQUE NOT NULL,
      created_by_user_id BIGINT NULL,
      created_at         TIMESTAMPTZ DEFAULT now()
    );
  `);

  // FK for teams.creator
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'teams'
          AND tc.constraint_name = 'fk_teams_creator'
      ) THEN
        ALTER TABLE teams
          ADD CONSTRAINT fk_teams_creator
          FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_teams_created_by ON teams(created_by_user_id);`);

  await query(`
    CREATE TABLE IF NOT EXISTS team_members (
      team_id   BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (team_id, user_id)
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);`);

  // TASKS
  await query(`
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
  await query(`
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
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'tasks'
          AND tc.constraint_name = 'fk_tasks_assignee'
      ) THEN
        ALTER TABLE tasks
          ADD CONSTRAINT fk_tasks_assignee
          FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  // Indices
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_due_ts ON tasks(due_ts);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_due_active ON tasks(due_ts) WHERE is_done = false;`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to_user_id);`);

  // TASK NOTIFICATIONS
  await query(`
    CREATE TABLE IF NOT EXISTS task_notifications (
      task_id          BIGINT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      sent_due_warning BOOLEAN NOT NULL DEFAULT false,
      sent_overdue     BOOLEAN NOT NULL DEFAULT false,
      updated_at       TIMESTAMPTZ DEFAULT now()
    );
  `);

  // CHATS
  await query(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated ON chat_sessions(user_id, updated_at DESC);`);

  await query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id         BIGSERIAL PRIMARY KEY,
      chat_id    BIGINT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role       TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, created_at);`);
}

async function getOrCreateUserByTg(tgUser) {
  if (!tgUser || !tgUser.id) {
    throw new Error("Missing tg user data (tgUser.id).");
  }

  const tg_id = Number(tgUser.id);
  const username = tgUser.username || null;
  const first_name = tgUser.first_name || null;
  const last_name = tgUser.last_name || null;

  const existing = await query(`SELECT * FROM users WHERE tg_id = $1`, [tg_id]);
  if (existing.rows.length) {
    // update basic fields (optional, but helpful)
    await query(
      `UPDATE users SET username=$2, first_name=$3, last_name=$4 WHERE tg_id=$1`,
      [tg_id, username, first_name, last_name]
    );
    return existing.rows[0];
  }

  const created = await query(
    `INSERT INTO users (tg_id, username, first_name, last_name)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [tg_id, username, first_name, last_name]
  );

  return created.rows[0];
}

async function getOrCreateUserIdByTgId(tg_id) {
  const tgIdNum = Number(tg_id);
  const res = await query(`SELECT id FROM users WHERE tg_id=$1`, [tgIdNum]);
  if (res.rows.length) return res.rows[0].id;

  const created = await query(
    `INSERT INTO users (tg_id) VALUES ($1) RETURNING id`,
    [tgIdNum]
  );
  return created.rows[0].id;
}

module.exports = {
  query,
  ensureSchema,
  getOrCreateUserByTg,
  getOrCreateUserIdByTgId,
};
