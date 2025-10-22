// api/calendar.js
// Возвращает задачи пользователя на выбранный день (для календаря)
import { sql } from '@vercel/postgres';
import { ensureSchema } from './_utils/db.js';
import { verifyTelegramInitNode, parseTelegramUser } from './_utils/tg_node.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow','GET');
      return res.status(405).end('Method Not Allowed');
    }

    const init = req.headers['x-telegram-init'] || '';
    const ok   = await verifyTelegramInitNode(init, process.env.BOT_TOKEN);
    if (!ok) return res.status(401).json({ error: 'INVALID_TELEGRAM_SIGNATURE' });

    const user = parseTelegramUser(init);
    if (!user?.id) return res.status(400).json({ error: 'NO_TELEGRAM_USER' });
    const tgId = BigInt(user.id);

    const day = String(req.query?.day || '');
    if (!day) return res.status(400).json({ error: 'DAY_REQUIRED' });

    await ensureSchema();

    const { rows } = await sql`
      SELECT id, title, list, due_date, due_time, done
      FROM tasks
      WHERE user_id = ${tgId} AND due_date = ${day}::date
      ORDER BY (due_time IS NULL), due_time ASC, created_at DESC
      LIMIT 400
    `;

    return res.status(200).json({ items: rows });

  } catch (e) {
    console.error('CALENDAR_ERROR', e);
    return res.status(500).json({ error: e?.code || e?.message || 'INTERNAL_ERROR' });
  }
}
