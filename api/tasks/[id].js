// api/tasks/[id].js
export const config = { runtime: 'nodejs' };

import { sql } from '@vercel/postgres';
import { ensureTables, requestIsSigned, getOrCreateUser, ok, err } from '../_utils/db.js';

export default async function handler(req) {
  try {
    await ensureTables();
    const init = req.headers.get('x-telegram-init') || '';
    const botToken = process.env.BOT_TOKEN || '';

    if (!requestIsSigned(init, botToken)) return err(401, 'UNAUTHORIZED');
    const user = await getOrCreateUser(init);
    if (!user) return err(401, 'NO_USER');

    const id = req.url.split('/').pop();

    if (req.method === 'PATCH') {
      const b = await req.json().catch(()=> ({}));
      const done = !!b.done;
      const r = await sql`
        UPDATE tasks SET done=${done}, updated_at=NOW()
        WHERE id=${id} AND user_id=${user.id}
        RETURNING *`;
      if (!r.rowCount) return err(404, 'NOT_FOUND');
      return ok(r.rows[0]);
    }

    if (req.method === 'DELETE') {
      await sql`DELETE FROM tasks WHERE id=${id} AND user_id=${user.id}`;
      return ok({ deleted: true });
    }

    return err(405, 'METHOD_NOT_ALLOWED');
  } catch (e) {
    return err(500, e?.message || 'INTERNAL_ERROR');
  }
}
