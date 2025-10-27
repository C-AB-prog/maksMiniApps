// /api/_db.js
import { Pool } from 'pg';

export const pool =
  global.pgPool ??
  new Pool({
    connectionString:
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_PRISMA_URL,
    ssl: { rejectUnauthorized: false },
  });

if (!global.pgPool) global.pgPool = pool;

export async function ensureSchema() {
  // Без внешних ключей к users — только bigint user_id + индексы.
  await pool.query(`
    create table if not exists tasks(
      id bigserial primary key,
      user_id bigint not null,
      title text not null,
      due_ts timestamptz null,
      done boolean not null default false,
      created_at timestamptz not null default now()
    );
    create index if not exists idx_tasks_user on tasks(user_id);

    create table if not exists focuses(
      id bigserial primary key,
      user_id bigint not null,
      text text not null,
      ts timestamptz not null default now()
    );
    create index if not exists idx_focuses_user on focuses(user_id);
  `);
}
