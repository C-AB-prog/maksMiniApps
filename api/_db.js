// /api/_db.js
const { Pool } = require('pg');

const CONN = process.env.POSTGRES_URL || process.env.DATABASE_URL || '';
if (!CONN) console.warn('[DB] POSTGRES_URL is not set.');

const pool = new Pool({
  connectionString: CONN,
  ssl: /sslmode=require/i.test(CONN) ? { rejectUnauthorized: false } : undefined,
});

async function ensureSchema() {
  await pool.query(`
    create table if not exists users (
      id text primary key,
      tg_id bigint,
      created_at timestamptz default now()
    );
    create unique index if not exists users_tg_idx on users(tg_id);

    create table if not exists focus (
      user_id text primary key references users(id) on delete cascade,
      text text not null,
      updated_at timestamptz default now()
    );

    create table if not exists tasks (
      id bigserial primary key,
      user_id text not null references users(id) on delete cascade,
      title text not null,
      scope text not null default 'today',
      done boolean not null default false,
      due_at timestamptz null,
      created_at timestamptz default now()
    );
    create index if not exists tasks_user_done_idx on tasks(user_id, done);
    create index if not exists tasks_due_idx on tasks(due_at);
  `);
}

async function upsertUser(me) {
  if (!me?.id) return;
  await pool.query(
    `insert into users(id, tg_id) values($1,$2)
     on conflict (id) do update set tg_id = coalesce(excluded.tg_id, users.tg_id)`,
    [me.id, me.tg_id || null]
  );
}

module.exports = { pool, ensureSchema, upsertUser };
