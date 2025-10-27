// /api/_db.js
const { Pool } = require('pg');

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

const pool = new Pool({
  connectionString: CONN,
  ssl: /sslmode=require/i.test(CONN) ? { rejectUnauthorized: false } : undefined,
});

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

async function ensureSchema() {
  await pool.query(`
    create table if not exists users (
      id text primary key,
      created_at timestamptz not null default now()
    )
  `);

  if (!(await columnExists('public', 'users', 'tg_id'))) {
    await pool.query(`alter table users add column tg_id text`);
  }

  await pool.query(`
    create table if not exists focus (
      user_id text primary key references users(id) on delete cascade,
      text text,
      updated_at timestamptz
    )
  `);

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

  await pool.query(`create index if not exists tasks_user_idx on tasks(user_id)`);
  await pool.query(`create index if not exists tasks_user_done_idx on tasks(user_id, done)`);
}

async function upsertUser(me) {
  await pool.query(
    `insert into users(id, tg_id) values($1,$2)
     on conflict (id) do update set tg_id = coalesce(excluded.tg_id, users.tg_id)`,
    [me.id, me.tg_id || null]
  );
}

module.exports = { pool, ensureSchema, upsertUser };
