// api/focus.js
export const config = { runtime: 'nodejs' };

import { sql } from '@vercel/postgres';
import {
  ensureTables, requestIsSigned, getOrCreateUser, ok, err
} from './_utils/db.js';

export default async function handler(req) {
  try {
    const init = req.headers.get('x-telegram-init') || '';
    const botToken = process.env.BOT_TOKEN || '';
    if (!requestIsSigned(init, botToken)) return err(401, 'INVALID_TELEGRAM_SIGNATURE');

    await ensureTables();
    const user = await getOrCreateUser(init);
    if (!user) return err(400,'NO_TELEGRAM_USER');

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const day = url.searchParams.get('day');
      if (!day) return err(400,'DAY_REQUIRED');

      const row = (await sql`
        SELECT text FROM focus WHERE user_id=${user.id} AND day=${day}
      `).rows[0];

      return ok({ text: row?.text || '' });
    }

    if (req.method === 'PUT') {
      const body = await req.json().catch(()=> ({}));
      const { day, text } = body || {};
      if (!day || !text) return err(400, 'DAY_AND_TEXT_REQUIRED');

      await sql`
        INSERT INTO focus (user_id, day, text, updated_at)
        VALUES (${user.id}, ${day}, ${text}, NOW())
        ON CONFLICT (user_id, day) DO UPDATE SET text=EXCLUDED.text, updated_at=NOW()
      `;
      return ok({ text });
    }

    return err(405, 'Method Not Allowed');
  } catch (e) {
    return err(500, e.message || 'INTERNAL_ERROR');
  }
}
