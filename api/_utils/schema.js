// /api/_utils/schema.js
import { sql } from '@vercel/postgres';

/**
 * Создаёт/мигрирует схему. Идempotентно.
 */
export async function ensureSchema() {
  // users
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id         BIGINT PRIMARY KEY,
      username   TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;

  // tasks (могла быть создана старой версией)
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
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);`;

  // focus
  await sql`
    CREATE TABLE IF NOT EXISTS focus (
      user_id    BIGINT PRIMARY KEY,
      text       TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `;
}

// alias для обратной совместимости
export const ensureTables = ensureSchema;
