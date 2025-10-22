// api/_utils/db.js
import { sql } from "@vercel/postgres";

let _schemaReady = false;

export async function ensureSchema() {
  if (_schemaReady) return;
  // Таблицы — безопасно вызывается многократно
  await sql/*sql*/`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      tg_id BIGINT UNIQUE NOT NULL,
      name TEXT,
      username TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      list TEXT NOT NULL CHECK (list IN ('today','week','backlog')),
      due_date DATE,
      due_time TIME,
      done BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS focus (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day DATE NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (user_id, day)
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day DATE NOT NULL,
      start TIME NOT NULL,
      dur INT NOT NULL DEFAULT 60,
      title TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  _schemaReady = true;
}

export async function getOrCreateUserByTelegram(tgUser) {
  const tgIdStr = String(tgUser?.id || "");
  if (!tgIdStr) throw new Error("NO_TG_ID");

  // Пытаемся найти
  const found = await sql/*sql*/`SELECT id FROM users WHERE tg_id = ${sql.raw(`${tgIdStr}::bigint`)};`;
  if (found.rows.length) return found.rows[0].id;

  // Иначе — создаём
  const name = tgUser.first_name || "";
  const username = tgUser.username || "";
  const inserted = await sql/*sql*/`
    INSERT INTO users (tg_id, name, username)
    VALUES (${sql.raw(`${tgIdStr}::bigint`)}, ${name}, ${username})
    ON CONFLICT (tg_id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id;
  `;
  return inserted.rows[0].id;
}
