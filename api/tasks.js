// api/tasks.js
// Runtime: Node (нужен доступ к Postgres)
export const config = { runtime: 'nodejs' };

import { sql } from '@vercel/postgres';
import { ensureTables, verifyTelegramInit, upsertUserFromInit, ok, err } from './_utils/db.js';
import crypto from 'crypto';

export default async function handler(req) {
  try {
    if (!['GET','POST'].includes(req.method)) {
      return err(405, 'Method Not Allowed');
    }

    const init = req.headers.get('x-telegram-init') || '';
    const botToken = process.env.BOT_TOKEN || '';
    if (!verifyTelegramInit(init, botToken)) return err(401, 'INVALID_TELEGRAM_SIGNATURE');

    await ensureTables();
    const user = await upsertUserFromInit(init);
    if (!user) return err(400, 'NO_TELEGRAM_USER');

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const list = url.searchParams.get('list'); // today|week|backlog (опционально)
      let rows;
      if (list) {
        rows = (await sql`
          SELECT id, title, list, done, due_date, due_time, hint
          FROM tasks WHERE user_id=${user.id} AND list=${list}
          ORDER BY created_at DESC
        `).rows;
      } else {
        rows = (await sql`
          SELECT id, title, list, done, due_date, due_time, hint
          FROM tasks WHERE user_id=${user.id}
          ORDER BY created_at DESC
        `).rows;
      }
      const items = rows.map(r => ({ ...r, due_date: r.due_date ? r.due_date.toISOString().slice(0,10) : null, due_time: r.due_time ? r.due_time.toString().slice(0,5) : null }));
      return ok({ items });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(()=> ({}));
      const { title, list='today', due_date=null, due_time=null, hint=null } = body || {};
      if (!title) return err(400, 'TITLE_REQUIRED');
      if (!['today','week','backlog'].includes(list)) return err(400,'INVALID_LIST');

      const id = crypto.randomUUID();
      await sql`
        INSERT INTO tasks (id, user_id, title, list, due_date, due_time, hint)
        VALUES (${id}, ${user.id}, ${title}, ${list},
                ${due_date || null}, ${due_time || null}, ${hint || null});
      `;
      const one = (await sql`
        SELECT id, title, list, done, due_date, due_time, hint
        FROM tasks WHERE id=${id}
      `).rows[0];

      return ok({
        id: one.id,
        title: one.title,
        list: one.list,
        done: one.done,
        due_date: one.due_date ? one.due_date.toISOString().slice(0,10) : null,
        due_time: one.due_time ? one.due_time.toString().slice(0,5) : null,
        hint: one.hint || null
      });
    }
  } catch (e) {
    return err(500, e.message || 'INTERNAL_ERROR');
  }
}
