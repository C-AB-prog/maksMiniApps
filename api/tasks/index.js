// api/tasks/index.js
import { sql } from '@vercel/postgres';
import { ensureSchema } from '../_utils/db.js';
import { verifyTelegramInitNode, parseTelegramUser } from '../_utils/tg_node.js';

export default async function handler(req, res) {
  try {
    // --- auth Telegram
    const init = req.headers['x-telegram-init'] || '';
    const ok   = await verifyTelegramInitNode(init, process.env.BOT_TOKEN);
    if (!ok) return res.status(401).json({ error: 'INVALID_TELEGRAM_SIGNATURE' });

    const user = parseTelegramUser(init);
    if (!user?.id) return res.status(400).json({ error: 'NO_TELEGRAM_USER' });
    const tgId = BigInt(user.id);

    // --- schema + user upsert
    await ensureSchema();
    await sql`
      INSERT INTO users (tg_id, name)
      VALUES (${tgId}, ${user.first_name || ''})
      ON CONFLICT (tg_id) DO UPDATE SET name = EXCLUDED.name
    `;

    if (req.method === 'GET') {
      const list = String(req.query?.list || 'today');
      const allow = new Set(['today','week','backlog']);
      if (!allow.has(list)) return res.status(400).json({ error: 'LIST_INVALID' });

      const { rows } = await sql`
        SELECT id, title, list, due_date, due_time, done
        FROM tasks
        WHERE user_id = ${tgId} AND list = ${list}
        ORDER BY created_at DESC
        LIMIT 200
      `;
      return res.status(200).json({ items: rows });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const title = (body.title || '').trim();
      if (!title) return res.status(400).json({ error: 'TITLE_REQUIRED' });

      const allow = new Set(['today','week','backlog']);
      const list  = allow.has(body.list) ? body.list : 'today';

      // пустые строки -> NULL
      const due_date = body.due_date || null;   // 'YYYY-MM-DD' | null
      const due_time = body.due_time || null;   // 'HH:mm'     | null

      const { rows } = await sql`
        INSERT INTO tasks (user_id, title, list, due_date, due_time)
        VALUES (${tgId}, ${title}, ${list}, ${due_date}::date, ${due_time}::time)
        RETURNING id, title, list, due_date, due_time, done
      `;
      return res.status(201).json(rows[0]);
    }

    res.setHeader('Allow','GET, POST');
    return res.status(405).end('Method Not Allowed');

  } catch (e) {
    console.error('TASKS_INDEX_ERROR', e);
    return res.status(500).json({ error: e?.code || e?.message || 'INTERNAL_ERROR' });
  }
}
