// /api/focus.js
import { sql } from '@vercel/postgres';
import { requireUser } from './_utils/tg_node.js';
import { ensureTables } from './_utils/schema.js';

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  await ensureTables();

  try {
    if (req.method === 'GET') {
      const { rows } = await sql`SELECT text FROM focus WHERE user_id=${user.id}`;
      return res.status(200).json({ text: rows[0]?.text || '' });
    }

    if (req.method === 'PUT') {
      const body = req.body || {};
      const text = (body.text || '').toString();

      // upsert по ключу user_id
      const { rows } = await sql`
        INSERT INTO focus (user_id, text, updated_at)
        VALUES (${user.id}, ${text}, now())
        ON CONFLICT (user_id) DO UPDATE
          SET text = EXCLUDED.text,
              updated_at = now()
        RETURNING text, updated_at
      `;
      return res.status(200).json({ text: rows[0].text });
    }

    return res.status(405).end();
  } catch (e) {
    console.error('focus error:', e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
