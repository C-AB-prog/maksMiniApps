// api/_utils/db.js
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL
});

export async function q(text, params) {
  const c = await pool.connect();
  try { return await c.query(text, params) }
  finally { c.release() }
}

export async function ensureTables() {
  await q(`
    create table if not exists users (
      id text primary key,
      created_at timestamp with time zone default now()
    );
  `);

  await q(`
    create table if not exists focus (
      user_id text primary key references users(id) on delete cascade,
      text text,
      updated_at timestamp with time zone default now()
    );
  `);

  await q(`
    create table if not exists tasks (
      id bigserial primary key,
      user_id text references users(id) on delete cascade,
      title text not null,
      scope text default 'today',
      due_at timestamp with time zone,
      done boolean default false,
      created_at timestamp with time zone default now(),
      updated_at timestamp with time zone default now()
    );
  `);

  // Добавим недостающие колонки (на случай старой схемы)
  await q(`alter table tasks add column if not exists updated_at timestamp with time zone default now()`);
  await q(`alter table tasks add column if not exists scope text default 'today'`);
}

export async function ensureUser(id){
  await q(`insert into users(id) values($1) on conflict do nothing`, [id]);
}
