// api/focus.js
import { sql } from '@vercel/postgres';
import { ensureSchema } from './_utils/db.js';
import { verifyTelegramInitNode, parseTelegramUser } from './_utils/tg_node.js';

/** GET /api/focus?day=YYYY-MM-DD
 *  PUT /api/focus { day: 'YYYY-MM-DD', text: '...' } */
export default async function handler(req, res) {
  try {
    // 1) Проверяем подпись Telegram
    const init = req.headers['x-telegram-init'] || '';
    const ok = await verifyTelegramInitNode(init, process.env.BOT_TOKEN);
    if (!ok) return res.status(401).json({ error: 'INVALID_TELEGRAM_SIGNATURE' });

    const user = parseTelegramUser(init);
    if (!user?.id) return res.status(400).json({ error: 'NO_TELEGRAM_USER' });

    const tgId = BigInt(user.id);

    // 2) Таблицы
    await ensureSchema();

    // 3) Убедимся, что пользователь есть
    await sql`
      INSERT INTO users (tg_id, name)
      VALUES (${tgId}, ${user.first_name || ''})
      ON CONFLICT (tg_id) DO UPDATE SET name = EXCLUDED.name
    `;

    if (req.method === 'GET') {
      const day = req.query?.day;
      if (!day) return res.status(400).json({ error: 'DAY_REQUIRED' });

      const { rows } = await sql`
        SELECT text FROM focus WHERE user_id = ${tgId} AND day = ${day}::date
      `;
      const text = rows[0]?.text || '';
      return res.status(200).json({ day, text });
    }

    if (req.method === 'PUT') {
      const { day, text } = (req.body || {});
      if (!day)  return res.status(400).json({ error: 'DAY_REQUIRED' });
      if (!text) return res.status(400).json({ error: 'TEXT_REQUIRED' });

      await sql`
        INSERT INTO focus(user_id, day, text)
        VALUES (${tgId}, ${day}::date, ${text})
        ON CONFLICT (user_id, day) DO UPDATE SET text = EXCLUDED.text
      `;

      return res.status(200).json({ day, text });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).end('Method Not Allowed');

  } catch (e) {
    // Покажем реальную причину (на время MVP это удобно)
    console.error('FOCUS_ERROR', e);
    return res.status(500).json({ error: e?.code || e?.message || 'INTERNAL_ERROR' });
  }
}
