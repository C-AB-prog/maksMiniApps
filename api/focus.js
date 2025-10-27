import { q, ensureSchema } from './_db.js';
import { getTgId, getOrCreateUserId } from './_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  if (req.method === 'GET') {
    const { rows } = await q(
      `SELECT id, text, created_at
       FROM focuses
       WHERE user_id = $1
       ORDER BY id DESC
       LIMIT 1`,
      [userId],
    );
    return res.json({ ok: true, focus: rows[0] || null });
  }

  if (req.method === 'POST') {
    const text = (req.body?.text || '').trim();
    if (!text) return res.status(400).json({ ok: false, error: 'text required' });

    const { rows } = await q(
      `INSERT INTO focuses (user_id, text)
       VALUES ($1, $2)
       RETURNING id, text, created_at`,
      [userId, text],
    );
    return res.json({ ok: true, focus: rows[0] });
  }

  return res.status(405).end();
}
