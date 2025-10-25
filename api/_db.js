// /api/_db.js
// Postgres (Neon) для Vercel Serverless
// - Берём строку подключения из нескольких env (Vercel Storage / ручная)
// - Переиспользуем pool между инвокациями (globalThis)
// - Автоматически создаём схему (users, focus, tasks)

const { Pool } = require('pg');

// Порядок приоритета: DATABASE_URL → POSTGRES_URL (Vercel+Neon pooled) → NON_POOLING → PRISMA
const connStr =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||              // РЕКОМЕНДУЕТСЯ для serverless (pgbouncer/pooled)
  process.env.POSTGRES_URL_NON_POOLING ||  // fallback
  process.env.POSTGRES_PRISMA_URL ||       // fallback
  '';

if (!connStr) {
  throw new Error(
    'DB connection string is missing. Set DATABASE_URL or POSTGRES_URL in environment variables.'
  );
}

// Переиспользуем один Pool в рамках "горячего" lambda-процесса
let pool;
if (globalThis.__ga_pg_pool) {
  pool = globalThis.__ga_pg_pool;
} else {
  pool = new Pool({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false }, // Neon требует SSL
    max: 3,                    // serverless-дружелюбно (мало одновременных коннектов)
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000
  });
  globalThis.__ga_pg_pool = pool;
}

// Однократная инициализация схемы (с защитой от гонок)
let _ready;
async function ensureSchema() {
  if (_ready) return _ready;
  _ready = (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id         BIGINT PRIMARY KEY,
          username   TEXT,
          first_name TEXT,
          last_name  TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS focus (
          user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          text       TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id         BIGSERIAL PRIMARY KEY,
          user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title      TEXT NOT NULL,
          scope      TEXT NOT NULL DEFAULT 'today',
          done       BOOLEAN NOT NULL DEFAULT FALSE,
          due_at     TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tasks_user_created
          ON tasks(user_id, created_at DESC);
      `);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      _ready = undefined; // позволим повторить инициализацию при следующем вызове
      throw e;
    } finally {
      client.release();
    }
  })();
  return _ready;
}

// Регистрация/обновление сведений о пользователе (по Telegram user)
async function upsertUser(u) {
  await ensureSchema();
  const { id, username=null, first_name=null, last_name=null } = u || {};
  await pool.query(
    `
    INSERT INTO users (id, username, first_name, last_name)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (id) DO UPDATE
      SET username=EXCLUDED.username,
          first_name=EXCLUDED.first_name,
          last_name=EXCLUDED.last_name;
    `,
    [id, username, first_name, last_name]
  );
}

module.exports = { pool, ensureSchema, upsertUser };
