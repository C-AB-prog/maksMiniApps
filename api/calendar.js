// api/calendar.js
export const config = { runtime: 'nodejs' };

import { sql } from '@vercel/postgres';
import { ensureTables, verifyTelegramInit, upsertUserFromInit, ok, err } from './_utils/db.js';

export default async function handler(req) {
  try {
    const init = req.headers.get('x-telegram-init') || '';
    const botToken = process.env.BOT_TOKEN || '';
    if (!verifyTelegramInit(init, botToken)) return err(401, 'INVALID_TELEGRAM_SIGNATURE');

    await ensureTables();
    const user = await upsertUserFromInit(init);
    if (!user) return err(400,'NO_TELEGRAM_USER');

    const url = new URL(req.url);
    const day = url.searchParams.get('day');
    if (!day) return err(400, 'DAY_REQUIRED');

    const rows = (await sql`
      SELECT id, title, due_date, due_time, list
      FROM tasks
      WHERE user_id=${user.id} AND due_date=${day}
      ORDER BY (due_time IS NULL), due_time ASC NULLS LAST, created_at DESC
    `).rows;

    const items = rows.map(r => ({
      id: r.id,
      title: r.title,
      due_date: r.due_date ? r.due_date.toISOString().slice(0,10) : null,
      due_time: r.due_time ? r.due_time.toString().slice(0,5) : null,
      list: r.list
    }));
    return ok({ items });
  } catch (e) {
    return err(500, e.message || 'INTERNAL_ERROR');
  }
}
