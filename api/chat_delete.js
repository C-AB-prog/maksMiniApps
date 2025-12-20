// api/chat_delete.js
// Удаление чата целиком (сессия + сообщения)

import { q, ensureSchema } from "./_db.js";
import { getTgId, getOrCreateUserId } from "./_utils.js";

export default async function handler(req, res) {
  await ensureSchema();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const tgId = getTgId(req) || Number(req.body?.tg_id || 0);
    if (!tgId) return res.status(400).json({ ok: false, error: "tg_id required" });

    const userId = await getOrCreateUserId(tgId);

    const chatId = Number(req.body?.chat_id || 0);
    if (!chatId) return res.status(400).json({ ok: false, error: "chat_id required" });

    const s = await q("SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2", [chatId, userId]);
    if (!s.rows.length) return res.status(404).json({ ok: false, error: "not_found" });

    await q("DELETE FROM chat_sessions WHERE id = $1", [chatId]);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[chat_delete] error", e);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
}
