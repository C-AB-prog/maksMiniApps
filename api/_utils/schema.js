// /api/_utils/schema.js
import { sql } from '@vercel/postgres';

/**
 * Создаём/мигрируем структуру БД. Вызываем перед любыми запросами.
 * Повторные вызовы безопасны (IF NOT EXISTS/ALTER IF NOT EXISTS).
 */
export async function ensureSchema() {
  // USERS
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id         BIGINT PRIMARY KEY,
      username   TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;

  // TASKS (могла быть создана старой версией — поэтому далее ALTER IF NOT EXISTS)
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
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;
  // миграции «добавить колонку, если её нет»
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);`;

  // FOCUS (фокус дня на пользователя — по одному)
  await sql`
    CREATE TABLE IF NOT EXISTS focus (
      user_id    BIGINT PRIMARY KEY,
      text       TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `;
}

// alias для обратной совместимости со старым импортом
export const ensureTables = ensureSchema;
