// /api/chat-history.js
// GET: ?limit=30 -> история для текущего tg_id (хронологически)

import { getTgId, getChatHistory, ensureSchema } from './_db.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }
    await ensureSchema();

    const tg_id = getTgId(req);
    if (!tg_id) return res.status(400).json({ ok: false, error: 'TG_ID_REQUIRED' });

    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 30)));
    const items = await getChatHistory(tg_id, limit);

    return res.status(200).json({ ok: true, items });
  } catch (e) {
    console.error('/api/chat-history error', e);
    return res.status(500).json({ ok: false, error: 'HISTORY_FAILED' });
  }
}
