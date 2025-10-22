// api/tasks/[id].js
import { sql } from '@vercel/postgres';
import { ensureSchema } from '../_utils/db.js';
import { verifyTelegramInitNode, parseTelegramUser } from '../_utils/tg_node.js';

export default async function handler(req, res) {
  try {
    const init = req.headers['x-telegram-init'] || '';
    const ok   = await verifyTelegramInitNode(init, process.env.BOT_TOKEN);
    if (!ok) return res.status(401).json({ error: 'INVALID_TELEGRAM_SIGNATURE' });

    const user = parseTelegramUser(init);
    if (!user?.id) return res.status(400).json({ error: 'NO_TELEGRAM_USER' });
    const tgId = BigInt(user.id);

    await ensureSchema();

    const idStr = String(req.query?.id || '');
    if (!/^\d+$/.test(idStr)) return res.status(400).json({ error: 'ID_REQUIRED' });
    const id = BigInt(idStr);

    if (req.method === 'PATCH') {
      const { title, list, due_date, due_time, done } = (req.body || {});
      const allow = new Set(['today','week','backlog']);
      const safeList = (list && allow.has(list)) ? list : null;

      const { rows } = await sql`
        UPDATE tasks
        SET
          title    = COALESCE(${title}, title),
          list     = COALESCE(${safeList}, list),
          due_date = COALESCE(${due_date}::date, due_date),
          due_time = COALESCE(${due_time}::time, due_time),
          done     = COALESCE(${done}, done)
        WHERE id = ${id} AND user_id = ${tgId}
        RETURNING id, title, list, due_date, due_time, done
      `;
      if (rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND' });
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const { rowCount } = await sql`
        DELETE FROM tasks WHERE id = ${id} AND user_id = ${tgId}
      `;
      if (rowCount === 0) return res.status(404).json({ error: 'NOT_FOUND' });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow','PATCH, DELETE');
    return res.status(405).end('Method Not Allowed');

  } catch (e) {
    console.error('TASKS_ID_ERROR', e);
    return res.status(500).json({ error: e?.code || e?.message || 'INTERNAL_ERROR' });
  }
}
