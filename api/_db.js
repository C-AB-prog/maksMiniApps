// /api/_db.js
// Универсальный доступ к Neon (Postgres) + схема + хелперы

import postgres from 'postgres';

let sql;
let schemaReady = false;

function getSql() {
  if (!sql) {
    const url = process.env.POSTGRES_URL;
    if (!url) throw new Error('POSTGRES_URL is not set');
    sql = postgres(url, { prepare: true, idle_timeout: 30, max: 1 });
  }
  return sql;
}

export async function ensureSchema() {
  if (schemaReady) return;
  const db = getSql();
  // Таблица задач
  await db/*sql*/`
    CREATE TABLE IF NOT EXISTS tasks (
      id          BIGSERIAL PRIMARY KEY,
      tg_id       BIGINT NOT NULL,
      title       TEXT NOT NULL,
      due_ts      BIGINT,
      is_done     BOOLEAN DEFAULT FALSE,
      priority    TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await db/*sql*/`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(tg_id);`;

  // Фокус дня (одна запись на пользователя)
  await db/*sql*/`
    CREATE TABLE IF NOT EXISTS focus (
      tg_id      BIGINT PRIMARY KEY,
      text       TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  // История чата
  await db/*sql*/`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id         BIGSERIAL PRIMARY KEY,
      tg_id      BIGINT NOT NULL,
      role       TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await db/*sql*/`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created
    ON chat_messages(tg_id, created_at);
  `;

  schemaReady = true;
}

// ===== utils =====
export function getTgId(req) {
  // Берём из заголовка X-TG-ID, либо query (?tg_id=)
  const hdr = req.headers['x-tg-id'] || req.headers['X-TG-ID'];
  const fromHeader = Array.isArray(hdr) ? hdr[0] : hdr;
  let id = fromHeader || (req.query ? req.query.tg_id : null);
  if (!id && req.body && typeof req.body === 'object') {
    id = req.body.tg_id || null;
  }
  const num = Number(id);
  if (!num || Number.isNaN(num)) return 0;
  return num;
}

// ===== chat =====
export async function getChatHistory(tg_id, limit = 30) {
  await ensureSchema();
  const db = getSql();
  const rows = await db/*sql*/`
    SELECT role, content, EXTRACT(EPOCH FROM created_at) * 1000 AS ts
    FROM chat_messages
    WHERE tg_id = ${tg_id}
    ORDER BY created_at DESC
    LIMIT ${limit};
  `;
  // Вернём в порядке возрастания времени:
  return rows.reverse();
}

export async function addChatMessage(tg_id, role, content) {
  await ensureSchema();
  const db = getSql();
  await db/*sql*/`
    INSERT INTO chat_messages (tg_id, role, content)
    VALUES (${tg_id}, ${role}, ${content});
  `;
}

export async function addChatPair(tg_id, userText, assistantText) {
  await ensureSchema();
  const db = getSql();
  await db.begin(async trx => {
    await trx/*sql*/`
      INSERT INTO chat_messages (tg_id, role, content)
      VALUES (${tg_id}, 'user', ${userText});
    `;
    await trx/*sql*/`
      INSERT INTO chat_messages (tg_id, role, content)
      VALUES (${tg_id}, 'assistant', ${assistantText});
    `;
  });
}

// ===== tasks (на будущее/совместимость) =====
export async function listTasks(tg_id) {
  await ensureSchema();
  const db = getSql();
  return db/*sql*/`
    SELECT id, title, due_ts, is_done, priority
    FROM tasks
    WHERE tg_id = ${tg_id}
    ORDER BY created_at DESC;
  `;
}

export async function createTask(tg_id, { title, due_ts = null, priority = null }) {
  await ensureSchema();
  const db = getSql();
  const [row] = await db/*sql*/`
    INSERT INTO tasks (tg_id, title, due_ts, priority)
    VALUES (${tg_id}, ${title}, ${due_ts}, ${priority})
    RETURNING id, title, due_ts, is_done, priority;
  `;
  return row;
}

export async function toggleTask(tg_id, id) {
  await ensureSchema();
  const db = getSql();
  const [row] = await db/*sql*/`
    UPDATE tasks
    SET is_done = NOT is_done
    WHERE id = ${id} AND tg_id = ${tg_id}
    RETURNING id, title, due_ts, is_done, priority;
  `;
  return row;
}

export async function deleteTask(tg_id, id) {
  await ensureSchema();
  const db = getSql();
  await db/*sql*/`DELETE FROM tasks WHERE id=${id} AND tg_id=${tg_id};`;
}

// ===== focus =====
export async function getFocus(tg_id) {
  await ensureSchema();
  const db = getSql();
  const rows = await db/*sql*/`SELECT text FROM focus WHERE tg_id=${tg_id};`;
  return rows[0]?.text || null;
}

export async function setFocus(tg_id, text) {
  await ensureSchema();
  const db = getSql();
  await db/*sql*/`
    INSERT INTO focus (tg_id, text, updated_at)
    VALUES (${tg_id}, ${text}, NOW())
    ON CONFLICT (tg_id) DO UPDATE SET text=EXCLUDED.text, updated_at=NOW();
  `;
  return { text };
}
