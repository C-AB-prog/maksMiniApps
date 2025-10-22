// api/_utils/db.js
import { sql } from '@vercel/postgres';

export async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      tg_id BIGINT PRIMARY KEY,
      name  TEXT
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS focus (
      user_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
      day     DATE   NOT NULL,
      text    TEXT   NOT NULL DEFAULT '',
      PRIMARY KEY (user_id, day)
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id        BIGSERIAL PRIMARY KEY,
      user_id   BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
      title     TEXT   NOT NULL,
      list      TEXT   NOT NULL DEFAULT 'today', -- today|week|backlog
      due_date  DATE,
      due_time  TIME,
      done      BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id      BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
      day     DATE   NOT NULL,
      start   TIME   NOT NULL,
      dur     INT    NOT NULL DEFAULT 60,
      title   TEXT   NOT NULL
    );
  `;
}
