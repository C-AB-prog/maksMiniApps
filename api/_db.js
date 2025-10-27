// api/_db.js
// Надёжная и «самолечащаяся» схема для Neon/Postgres без FK,
// чтобы не падать из-за старых таблиц/данных.

import { Client } from 'pg';

let _client;
async function client() {
  if (_client?.__ready) return _client;
  _client = new Client({ connectionString: process.env.POSTGRES_URL });
  await _client.connect();
  _client.__ready = true;
  return _client;
}

export async function sql(q, params = []) {
  const c = await client();
  return c.query(q, params);
}

// безопасный вызов (не валит процесс при несовместимых старых состояниях)
async function safe(q, params = []) {
  try { await sql(q, params); } catch { /* ignore */ }
}

// Создание/починка схемы — вызывается на каждом запросе health/и т.д.
export async function ensureSchema() {
  // Снять старые конфликтующие FK, если вдруг остались
  await safe(`ALTER TABLE IF EXISTS focuses DROP CONSTRAINT IF EXISTS focuses_user_id_fkey;`);
  await safe(`ALTER TABLE IF EXISTS tasks   DROP CONSTRAINT IF EXISTS tasks_user_id_fkey;`);

  // Базовые таблицы
  await sql(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // focuses: делаем простую таблицу без внешнего ключа
  await sql(`
    CREATE TABLE IF NOT EXISTS focuses (
      user_id   TEXT PRIMARY KEY,
      text      TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // На всякий случай — если у кого-то была старая колонка tg_id
  await safe(`ALTER TABLE focuses RENAME COLUMN tg_id TO user_id;`);
  await safe(`ALTER TABLE focuses ADD COLUMN IF NOT EXISTS user_id TEXT;`);
  await safe(`ALTER TABLE focuses ADD COLUMN IF NOT EXISTS text TEXT NOT NULL DEFAULT '';`);
  await safe(`ALTER TABLE focuses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();`);

  // tasks: без FK, с индексом по user_id
  await sql(`
    CREATE TABLE IF NOT EXISTS tasks (
      id           SERIAL PRIMARY KEY,
      user_id      TEXT NOT NULL,
      title        TEXT NOT NULL,
      scope        TEXT NOT NULL DEFAULT 'today',  -- today|week|backlog
      status       TEXT NOT NULL DEFAULT 'open',   -- open|done
      due_at       TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT now(),
      completed_at TIMESTAMPTZ
    );
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);`);
}

export async function getOrCreateUser(userId) {
  await ensureSchema();
  await sql(`INSERT INTO users(id) VALUES ($1) ON CONFLICT DO NOTHING;`, [userId]);
  return userId;
}

// Focus
export async function readFocus(uid) {
  const { rows } = await sql(`SELECT text FROM focuses WHERE user_id=$1`, [uid]);
  return rows[0]?.text ?? '';
}
export async function writeFocus(uid, text) {
  await sql(
    `INSERT INTO focuses(user_id, text, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET text=EXCLUDED.text, updated_at=now();`,
    [uid, text || '']
  );
}

// Tasks
export async function listTasks(uid) {
  const { rows } = await sql(
    `SELECT id, title, scope, status,
            due_at       AS "dueAt",
            created_at   AS "createdAt",
            completed_at AS "completedAt"
       FROM tasks
      WHERE user_id=$1
      ORDER BY id DESC`, [uid]);
  return rows;
}
export async function addTask(uid, { title, scope='today', dueDate=null }) {
  const { rows } = await sql(
    `INSERT INTO tasks(user_id, title, scope, due_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, scope, status,
               due_at AS "dueAt",
               created_at AS "createdAt",
               completed_at AS "completedAt"`,
    [uid, title, scope, dueDate]
  );
  return rows[0];
}
export async function toggleTask(uid, { id, done }) {
  const { rows } = await sql(
    `UPDATE tasks
        SET status = CASE WHEN $3 THEN 'done' ELSE 'open' END,
            completed_at = CASE WHEN $3 THEN now() ELSE NULL END
      WHERE id=$2 AND user_id=$1
   RETURNING id, title, scope, status,
             due_at AS "dueAt",
             created_at AS "createdAt",
             completed_at AS "completedAt"`,
    [uid, id, !!done]
  );
  return rows[0];
}
export async function deleteTask(uid, id) {
  await sql(`DELETE FROM tasks WHERE id=$2 AND user_id=$1`, [uid, id]);
}
