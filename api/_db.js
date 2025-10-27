// api/_db.js
// Простой драйвер + автосхема для Neon (pooled, ssl=require)

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

// Создание/миграция схемы — безопасно вызываетcя много раз
export async function ensureSchema() {
  await sql(`
    create table if not exists users (
      id text primary key,
      created_at timestamptz default now()
    );

    create table if not exists focuses (
      user_id text primary key references users(id) on delete cascade,
      text     text not null default '',
      updated_at timestamptz default now()
    );

    create table if not exists tasks (
      id serial primary key,
      user_id text not null references users(id) on delete cascade,
      title text not null,
      scope text not null default 'today', -- today | week | backlog
      status text not null default 'open', -- open | done
      due_at timestamptz,
      created_at timestamptz default now(),
      completed_at timestamptz
    );
  `);
}

export async function getOrCreateUser(userId) {
  await ensureSchema();
  await sql(`insert into users(id) values($1) on conflict do nothing;`, [userId]);
  return userId;
}

// Focus
export async function readFocus(uid) {
  const { rows } = await sql(`select text from focuses where user_id=$1`, [uid]);
  return rows[0]?.text ?? '';
}
export async function writeFocus(uid, text) {
  await sql(
    `insert into focuses(user_id,text,updated_at)
     values($1,$2,now())
     on conflict (user_id) do update set text=excluded.text, updated_at=now();`,
    [uid, text || '']
  );
}

// Tasks
export async function listTasks(uid) {
  const { rows } = await sql(
    `select id,title,scope,status,due_at as "dueAt",created_at as "createdAt",completed_at as "completedAt"
     from tasks where user_id=$1 order by id desc`, [uid]);
  return rows;
}
export async function addTask(uid, { title, scope='today', dueDate=null }) {
  const { rows } = await sql(
    `insert into tasks(user_id,title,scope,due_at) values($1,$2,$3,$4)
     returning id,title,scope,status,due_at as "dueAt",created_at as "createdAt",completed_at as "completedAt"`,
    [uid, title, scope, dueDate]
  );
  return rows[0];
}
export async function toggleTask(uid, { id, done }) {
  const { rows } = await sql(
    `update tasks set
       status = case when $3 then 'done' else 'open' end,
       completed_at = case when $3 then now() else null end
     where id=$2 and user_id=$1
     returning id,title,scope,status,due_at as "dueAt",created_at as "createdAt",completed_at as "completedAt"`,
    [uid, id, !!done]
  );
  return rows[0];
}
export async function deleteTask(uid, id) {
  await sql(`delete from tasks where id=$2 and user_id=$1`, [uid, id]);
}
