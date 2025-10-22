// api/calendar.js
export const config = { runtime: 'nodejs' };

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

    const url = new URL(req.url);
    const day = url.searchParams.get('day');
    if (!day) return ok({ items: [] });

    const r = await sql`
      SELECT id, title, list, due_date, due_time
      FROM tasks
      WHERE user_id=${user.id} AND due_date=${day}
      ORDER BY COALESCE(due_time, TIME '00:00') ASC, created_at DESC`;
    return ok({ items: r.rows });
  } catch (e) {
    return err(500, e?.message || 'INTERNAL_ERROR');
  }
}
