const { Pool } = require('pg');

const connStr =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL || '';

if (!connStr) throw new Error('DB connection string is missing.');

let pool;
if (globalThis.__ga_pg_pool) {
  pool = globalThis.__ga_pg_pool;
} else {
  pool = new Pool({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000
  });
  globalThis.__ga_pg_pool = pool;
}

let _ready;
async function ensureSchema() {
  if (_ready) return _ready;
  _ready = (async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');

      await c.query(`
        CREATE TABLE IF NOT EXISTS users (
          id         BIGINT PRIMARY KEY,           -- Telegram user_id или анонимный
          username   TEXT,
          first_name TEXT,
          last_name  TEXT,
          tz         TEXT,                         -- IANA TZ
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);

      await c.query(`
        CREATE TABLE IF NOT EXISTS focus (
          user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          text       TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_by TEXT
        );
      `);

      await c.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id         BIGSERIAL PRIMARY KEY,
          user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          parent_id  BIGINT REFERENCES tasks(id) ON DELETE CASCADE, -- подзадачи
          title      TEXT NOT NULL,
          notes      TEXT,
          scope      TEXT NOT NULL DEFAULT 'today',
          priority   INT NOT NULL DEFAULT 0,
          done       BOOLEAN NOT NULL DEFAULT FALSE,
          due_at     TIMESTAMPTZ,
          remind_at  TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, created_at DESC);`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(user_id, due_at);`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(user_id, parent_id);`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_tasks_remind ON tasks(user_id, remind_at);`);

      await c.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id        BIGSERIAL PRIMARY KEY,
          user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          task_id   BIGINT REFERENCES tasks(id) ON DELETE CASCADE,
          type      TEXT NOT NULL,            -- 'reminder' | 'digest'
          run_at    TIMESTAMPTZ NOT NULL,
          payload   JSONB,
          sent_at   TIMESTAMPTZ,
          error     TEXT
        );
      `);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_notifications_run ON notifications(user_id, run_at) WHERE sent_at IS NULL;`);

      await c.query(`
        CREATE TABLE IF NOT EXISTS experiments (
          id         BIGSERIAL PRIMARY KEY,
          user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title      TEXT NOT NULL,
          hypothesis TEXT,
          action     TEXT,
          metric     TEXT,
          target     TEXT,
          status     TEXT NOT NULL DEFAULT 'planned', -- planned|running|done|canceled
          start_at   TIMESTAMPTZ,
          end_at     TIMESTAMPTZ,
          result     TEXT,
          next_step  TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK'); _ready = undefined; throw e;
    } finally {
      c.release();
    }
  })();
  return _ready;
}

async function upsertUser(u, tz) {
  await ensureSchema();
  const { id, username=null, first_name=null, last_name=null } = u || {};
  await pool.query(
    `INSERT INTO users (id, username, first_name, last_name, tz)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE
       SET username=EXCLUDED.username,
           first_name=EXCLUDED.first_name,
           last_name=EXCLUDED.last_name,
           tz=COALESCE(EXCLUDED.tz, users.tz)`,
    [id, username, first_name, last_name, tz || null]
  );
}

module.exports = { pool, ensureSchema, upsertUser };
