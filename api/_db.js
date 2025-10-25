const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// создаём таблицы при первом вызове
let _ready;
async function ensureSchema() {
  if (_ready) return _ready;
  _ready = (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id        BIGINT PRIMARY KEY,
          username  TEXT,
          first_name TEXT,
          last_name  TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS focus (
          user_id   BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          text      TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id        BIGSERIAL PRIMARY KEY,
          user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title     TEXT NOT NULL,
          scope     TEXT NOT NULL DEFAULT 'today',
          done      BOOLEAN NOT NULL DEFAULT FALSE,
          due_at    TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks(user_id, created_at DESC);`);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK'); throw e;
    } finally {
      client.release();
    }
  })();
  return _ready;
}

async function upsertUser(u) {
  await ensureSchema();
  const { id, username=null, first_name=null, last_name=null } = u || {};
  await pool.query(`
    INSERT INTO users (id, username, first_name, last_name)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (id) DO UPDATE
      SET username=EXCLUDED.username, first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name;`,
    [id, username, first_name, last_name]
  );
}

module.exports = { pool, ensureSchema, upsertUser };
