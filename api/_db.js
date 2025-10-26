// /api/_db.js
// Надёжное подключение к Postgres (Neon) + авто-схема.
// Зависимости: "pg" (в package.json), Node.js 20.x.

const { Pool } = require('pg');

// Берём строку подключения прежде всего из POSTGRES_URL.
// Остальные ключи оставлены как резервные, если ты их уже настроил.
const cn =
  process.env.MANUAL_POSTGRES_URL ||   // читаем в приоритете
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING;


if (!cn) {
  // Не падаем синхронно — чтобы обработчик мог вернуть понятную ошибку JSON.
  console.warn('[DB] WARNING: no Postgres connection string in env (set POSTGRES_URL)');
}

let pool;

/** Ленивое создание пула. Бросит понятную ошибку, если нет строки подключения. */
function getPool() {
  if (pool) return pool;
  if (!cn) throw new Error('No Postgres connection string: set POSTGRES_URL in Vercel → Settings → Environment Variables');

  pool = new Pool({
    connectionString: cn,
    max: 5,                         // достаточно для serverless
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: false } // для Neon (sslmode=require)
  });

  // Лёгкая самопроверка соединения — не обязательна
  pool
    .query('select 1')
    .then(() => console.log('[DB] connected'))
    .catch((e) => console.error('[DB] initial connect error:', e));

  return pool;
}

/** Создаёт таблицы и индексы, если их ещё нет. Вызывать перед работой с БД. */
async function ensureSchema() {
  const p = getPool();

  // users: хранит уникальный app_user_id (из куки), опционально tg_id
  await p.query(`
    create table if not exists users (
      id        text primary key,
      tg_id     text,
      created_at timestamptz default now()
    )
  `);

  // tasks: задачи пользователя
  await p.query(`
    create table if not exists tasks (
      id         bigserial primary key,
      user_id    text not null references users(id) on delete cascade,
      title      text not null,
      scope      text not null default 'today',   -- today | week | backlog
      done       boolean not null default false,
      due_at     timestamptz null,
      remind_at  timestamptz null,
      priority   int not null default 0,
      notes      text,
      created_at timestamptz default now()
    )
  `);

  // focus: один фокус на пользователя
  await p.query(`
    create table if not exists focus (
      user_id    text primary key references users(id) on delete cascade,
      text       text not null,
      updated_at timestamptz default now()
    )
  `);

  // Индексы
  await p.query(`create index if not exists idx_tasks_user_id on tasks(user_id)`);
  await p.query(`create index if not exists idx_tasks_due_at on tasks(due_at)`);
  await p.query(`create index if not exists idx_tasks_user_done on tasks(user_id, done)`);
}

/** Гарантирует, что пользователь есть в таблице. */
async function upsertUser(user) {
  const p = getPool();
  await ensureSchema();
  await p.query(
    `insert into users(id, tg_id) values($1,$2)
     on conflict (id) do nothing`,
    [user.id, user.tg_id || null]
  );
}

// Аккуратно закрываем пул при выгрузке функции (не обязательно, но полезно)
function _gracefulShutdown() {
  if (pool) {
    pool.end().catch(() => {});
    pool = undefined;
  }
}
process.on?.('beforeExit', _gracefulShutdown);
process.on?.('SIGTERM', _gracefulShutdown);
process.on?.('SIGINT', _gracefulShutdown);

module.exports = {
  // Экспортируем как геттер, чтобы пул создавался лениво
  get pool() {
    return getPool();
  },
  ensureSchema,
  upsertUser,
};
