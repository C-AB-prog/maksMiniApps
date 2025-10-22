// api/tasks/[id].js
export const config = { runtime: 'nodejs' };

import { sql } from '@vercel/postgres';
import { ensureTables, verifyTelegramInit, upsertUserFromInit, ok, err } from '../_utils/db.js';

export default async function handler(req) {
  try {
    const { pathname } = new URL(req.url);
    const id = decodeURIComponent(pathname.split('/').pop() || '');
    if (!id) return err(400,'ID_REQUIRED');

    const init = req.headers.get('x-telegram-init') || '';
    const botToken = process.env.BOT_TOKEN || '';
    if (!verifyTelegramInit(init, botToken)) return err(401, 'INVALID_TELEGRAM_SIGNATURE');

    await ensureTables();
    const user = await upsertUserFromInit(init);
    if (!user) return err(400,'NO_TELEGRAM_USER');

    if (req.method === 'PATCH') {
      const body = await req.json().catch(()=> ({}));
      const { done, title, list, due_date, due_time, hint } = body;

      // формируем динамический апдейт
      const fields = [];
      if (typeof done === 'boolean') fields.push(sql`done=${done}`);
      if (title !== undefined)       fields.push(sql`title=${title}`);
      if (list  !== undefined)       fields.push(sql`list=${list}`);
      if (due_date !== undefined)    fields.push(sql`due_date=${due_date || null}`);
      if (due_time !== undefined)    fields.push(sql`due_time=${due_time || null}`);
      if (hint !== undefined)        fields.push(sql`hint=${hint}`);

      if (!fields.length) return err(400,'NOTHING_TO_UPDATE');

      await sql`UPDATE tasks SET ${sql.join(fields, sql`, `)}, updated_at=NOW()
                WHERE id=${id} AND user_id=${user.id}`;

      const one = (await sql`
        SELECT id, title, list, done, due_date, due_time, hint
        FROM tasks WHERE id=${id} AND user_id=${user.id}
      `).rows[0];

      if (!one) return err(404, 'NOT_FOUND');

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

    if (req.method === 'DELETE') {
      await sql`DELETE FROM tasks WHERE id=${id} AND user_id=${user.id}`;
      return ok({ deleted: true });
    }

    return err(405, 'Method Not Allowed');
  } catch (e) {
    return err(500, e.message || 'INTERNAL_ERROR');
  }
}
