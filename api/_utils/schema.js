// /api/_utils/schema.js
import { sql } from '@vercel/postgres';

let inited = false;

/** Однократная инициализация схемы БД (создание таблиц/индексов). */
export async function ensureSchema() {
  if (inited) return;
  // focus: уникальная запись на (user_id, day)
  await sql`
    CREATE TABLE IF NOT EXISTS focus (
      user_id BIGINT NOT NULL,
      day DATE NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      meta TEXT DEFAULT '',
      progress_pct INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, day)
    );
  `;

  // tasks: список задач пользователя
  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      title TEXT NOT NULL,
      list TEXT NOT NULL DEFAULT 'today',
      note TEXT,
      icon TEXT,
      done BOOLEAN NOT NULL DEFAULT false,
      deadline TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_user_list_created ON tasks (user_id, list, created_at DESC);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_user_deadline ON tasks (user_id, deadline);`;

  inited = true;
}
