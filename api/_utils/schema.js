// /api/_utils/schema.js
import { sql } from '@vercel/postgres';

/**
 * Создаёт таблицы, если их ещё нет. Вызываем перед любыми запросами.
 */
export async function ensureSchema() {
  // пользователи
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id        BIGINT PRIMARY KEY,
      username  TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;

  // задачи
  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT NOT NULL,
      title      TEXT   NOT NULL,
      list       TEXT   NOT NULL DEFAULT 'today',
      note       TEXT,
      icon       TEXT,
      done       BOOLEAN NOT NULL DEFAULT FALSE,
      deadline   TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);`;
}

/** alias для старого импорта */
export const ensureTables = ensureSchema;
