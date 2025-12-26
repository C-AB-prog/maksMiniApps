// api/_db.js
const { Pool } = require("pg");

let _pool;

/**
 * IMPORTANT:
 * У тебя в Vercel много Postgres env. Чтобы не “улетать” в другую БД —
 * приоритетно используем MANUAL_POSTGRES_URL (если задан),
 * иначе DATABASE_URL/POSTGRES_URL и т.д.
 */
function getPool() {
  if (_pool) return _pool;

  const candidates = [
    ["MANUAL_POSTGRES_URL", process.env.MANUAL_POSTGRES_URL],
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["POSTGRES_URL", process.env.POSTGRES_URL],
    ["POSTGRES_PRISMA_URL", process.env.POSTGRES_PRISMA_URL],
    ["POSTGRES_URL_NON_POOLING", process.env.POSTGRES_URL_NON_POOLING],
    ["POSTGRES_CONNECTION_STRING", process.env.POSTGRES_CONNECTION_STRING],
  ];

  let chosenName = null;
  let connectionString = null;

  for (const [name, val] of candidates) {
    if (val && String(val).trim()) {
      chosenName = name;
      connectionString = String(val).trim();
      break;
    }
  }

  if (!connectionString) {
    throw new Error(
      "Missing DB connection string env var. Set one of: MANUAL_POSTGRES_URL, DATABASE_URL, POSTGRES_URL."
    );
  }

  // Helpful in Vercel logs: shows which env var is actually used (without leaking password)
  try {
    const u = new URL(connectionString);
    console.log(
      "[DB] using",
      chosenName,
      "host=",
      u.hostname,
      "db=",
      (u.pathname || "").replace("/", "")
    );
  } catch {
    console.log("[DB] using", chosenName);
  }

  _pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  return _pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

/**
 * Создаёт/обновляет схему БД (idempotent). НИЧЕГО НЕ УДАЛЯЕТ.
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

  // Indexes
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_user   ON tasks(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_due_ts ON tasks(due_ts);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_due_active ON tasks(due_ts) WHERE is_done = false;`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_team   ON tasks(team_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to_user_id);`);
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
        FROM information_schema.table_constraints
        WHERE table_name = 'teams'
          AND constraint_name = 'fk_teams_created_by'
      ) THEN
        ALTER TABLE teams
          ADD CONSTRAINT fk_teams_created_by
          FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_teams_created_by ON teams(created_by_user_id);`);

  // TEAM MEMBERS
  await query(`
    CREATE TABLE IF NOT EXISTS team_members (
      team_id    BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at  TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (team_id, user_id)
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);`);

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
          AND tc.constraint_name = 'fk_tasks_assigned_to'
      ) THEN
        ALTER TABLE tasks
          ADD CONSTRAINT fk_tasks_assigned_to
          FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  // TASK NOTIFICATIONS
  await query(`
    CREATE TABLE IF NOT EXISTS task_notifications (
      task_id           BIGINT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      sent_due_warning  BOOLEAN NOT NULL DEFAULT false,
      sent_overdue      BOOLEAN NOT NULL DEFAULT false,
      updated_at        TIMESTAMPTZ DEFAULT now()
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

  // (для уведомлений) prefs — безопасно, IF NOT EXISTS
  await query(`
    CREATE TABLE IF NOT EXISTS notification_prefs (
      user_id        BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      enabled        BOOLEAN NOT NULL DEFAULT false,
      interval_hours INT NOT NULL DEFAULT 4,
      start_hour     INT NOT NULL DEFAULT 9,
      end_hour       INT NOT NULL DEFAULT 21,
      tz_offset_min  INT NOT NULL DEFAULT 0,
      last_sent_at   TIMESTAMPTZ NULL,
      created_at     TIMESTAMPTZ DEFAULT now(),
      updated_at     TIMESTAMPTZ DEFAULT now()
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_notification_prefs_enabled ON notification_prefs(enabled);`);
}

async function getOrCreateUserByTg(tgUser) {
  const tgIdNum = Number(tgUser?.id || tgUser?.tg_id || tgUser);
  if (!tgIdNum) throw new Error("tg_id is missing");

  const username = tgUser?.username ?? null;
  const first_name = tgUser?.first_name ?? null;
  const last_name = tgUser?.last_name ?? null;

  const { rows } = await query(`SELECT * FROM users WHERE tg_id = $1`, [tgIdNum]);
  if (rows.length) return rows[0];

  const ins = await query(
    `INSERT INTO users (tg_id, username, first_name, last_name)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [tgIdNum, username, first_name, last_name]
  );
  return ins.rows[0];
}

async function getOrCreateUserIdByTgId(tgId) {
  const tgIdNum = Number(tgId);
  if (!tgIdNum) throw new Error("tg_id is missing");

  const res = await query(`SELECT id FROM users WHERE tg_id = $1`, [tgIdNum]);
  if (res.rows.length) return res.rows[0].id;

  const created = await query(`INSERT INTO users (tg_id) VALUES ($1) RETURNING id`, [tgIdNum]);
  return created.rows[0].id;
}

module.exports = {
  pool: getPool,
  query,
  q: query,
  ensureSchema,
  getOrCreateUserByTg,
  getOrCreateUserIdByTgId,
};
