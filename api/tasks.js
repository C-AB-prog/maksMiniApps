// api/tasks.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';
import { sql } from '@vercel/postgres';
import { ensureTables, requestIsSigned, getOrCreateUser, ok, err } from './_utils/db.js';

export default async function handler(req) {
  try {
    await ensureTables();
    const init = req.headers.get('x-telegram-init') || '';
    const botToken = process.env.BOT_TOKEN || '';

    if (!requestIsSigned(init, botToken)) return err(401, 'UNAUTHORIZED');
    const user = await getOrCreateUser(init);
    if (!user) return err(401, 'NO_USER');

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const list = url.searchParams.get('list') || 'today';
      const r = await sql`SELECT * FROM tasks WHERE user_id=${user.id} AND list=${list} ORDER BY created_at DESC LIMIT 200`;
      return ok({ items: r.rows });
    }

    if (req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const title = (b.title || '').trim();
      const list = b.list || 'today';
      const due_date = b.due_date || null;
      const due_time = b.due_time || null;
      if (!title) return err(400, 'TITLE_REQUIRED');

      const id = crypto.randomUUID();
      const r = await sql`
        INSERT INTO tasks (id, user_id, title, list, due_date, due_time)
        VALUES (${id}, ${user.id}, ${title}, ${list}, ${due_date}, ${due_time})
        RETURNING *`;
      return ok(r.rows[0]);
    }

    return err(405, 'METHOD_NOT_ALLOWED');
  } catch (e) {
    return err(500, e?.message || 'INTERNAL_ERROR');
  }
}
