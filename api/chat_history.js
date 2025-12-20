// api/chat_history.js
import { q, ensureSchema } from "./_db.js";
import { getTgId, getOrCreateUserId } from "./_utils.js";

export default async function handler(req, res) {
  await ensureSchema();

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const tgId = getTgId(req) || Number(req.query?.tg_id || 0);
    const chatId = Number(req.query?.chat_id || 0);

    if (!tgId || !chatId) return res.status(200).json({ ok: true, messages: [] });

    const userId = await getOrCreateUserId(tgId);

    const s = await q("SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2", [chatId, userId]);
    if (!s.rows.length) return res.status(200).json({ ok: true, messages: [] });

    const r = await q(
      `SELECT role, content, created_at
       FROM chat_messages
       WHERE chat_id = $1
       ORDER BY id ASC`,
      [chatId],
    );

    return res.status(200).json({ ok: true, messages: r.rows || [] });
  } catch (e) {
    console.error("[chat_history] error", e);
    return res.status(200).json({ ok: true, messages: [] });
  }
}
