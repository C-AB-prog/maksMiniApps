// /api/_db.js
const { Pool } = require('pg');

// Берём любую валидную строку подключения
const CONN =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.MANUAL_POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL_UNPOOLED;

if (!CONN) {
  throw new Error(
    'No Postgres connection string found. Set POSTGRES_URL (pooled, sslmode=require).'
  );
}

// Пул создаём один раз
const pool = new Pool({
  connectionString: CONN,
  // если в строке уже есть sslmode=require — ниже можно не указывать
  ssl: /sslmode=require/i.test(CONN) ? { rejectUnauthorized: false } : undefined,
});

// утилита: проверить существование колонки
async function columnExists(schema, table, column) {
  const q = `
    select 1
    from information_schema.columns
    where table_schema=$1 and table_name=$2 and column_name=$3
    limit 1
  `;
  const r = await pool.query(q, [schema, table, column]);
  return r.rowCount > 0;
}

// Создать/мигрировать схему
async function ensureSchema() {
  // users
  await pool.query(`
    create table if not exists users (
      id text primary key,
      created_at timestamptz not null default now()
    )
  `);

  // если нет tg_id — добавим (без потери данных)
  if (!(await columnExists('public', 'users', 'tg_id'))) {
    await pool.query(`alter table users add column tg_id text`);
  }

  // focus
  await pool.query(`
    create table if not exists focus (
      user_id text primary key references users(id) on delete cascade,
      text text,
      updated_at timestamptz
    )
  `);

  // tasks
  await pool.query(`
    create table if not exists tasks (
      id bigserial primary key,
      user_id text not null references users(id) on delete cascade,
      title text not null,
      scope text not null default 'today',
      due_at timestamptz,
      done boolean not null default false,
      created_at timestamptz not null default now()
    )
  `);

  // индексы
  await pool.query(`create index if not exists tasks_user_idx on tasks(user_id)`);
  await pool.query(`create index if not exists tasks_user_done_idx on tasks(user_id, done)`);
}

// создать/обновить пользователя (по нашей cookie uid)
async function upsertUser(me) {
  // me = { id, tg_id }
  await pool.query(
    `insert into users(id, tg_id) values($1,$2)
     on conflict (id) do update set tg_id = coalesce(excluded.tg_id, users.tg_id)`,
    [me.id, me.tg_id || null]
  );
}

module.exports = { pool, ensureSchema, upsertUser };
