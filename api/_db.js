// /api/_db.js
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// Для Neon и большинства managed PG нужен SSL.
// Если в строке уже есть ?sslmode=require — ok; на всякий случай включим SSL явно.
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Создание таблиц, если их нет
async function ensureSchema() {
  await pool.query(`
    create table if not exists users(
      id bigint primary key,
      username text,
      first_name text,
      last_name text,
      tz text default 'UTC',
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
    create table if not exists focus(
      user_id bigint primary key references users(id) on delete cascade,
      text text not null,
      updated_at timestamptz default now()
    );
    create table if not exists tasks(
      id bigserial primary key,
      user_id bigint not null references users(id) on delete cascade,
      title text not null,
      scope text default 'today',
      done boolean default false,
      priority int default 0,
      due_at timestamptz,
      remind_at timestamptz,
      notes text,
      created_at timestamptz default now()
    );
    create table if not exists notifications(
      id bigserial primary key,
      user_id bigint not null,
      task_id bigint,
      type text not null,  -- 'reminder' | 'digest'
      run_at timestamptz default now(),
      payload jsonb,
      sent_at timestamptz,
      error text
    );
  `);
}

async function upsertUser(u, tz='UTC') {
  await pool.query(
    `insert into users (id, username, first_name, last_name, tz)
     values ($1,$2,$3,$4,$5)
     on conflict (id) do update set
       username = excluded.username,
       first_name = excluded.first_name,
       last_name  = excluded.last_name,
       tz = coalesce(excluded.tz, users.tz),
       updated_at = now()`,
    [u.id, u.username || null, u.first_name || null, u.last_name || null, tz || 'UTC']
  );
}

module.exports = { pool, ensureSchema, upsertUser };
