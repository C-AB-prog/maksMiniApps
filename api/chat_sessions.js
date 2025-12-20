// api/chat_sessions.js
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
    if (!tgId) return res.status(200).json({ ok: true, sessions: [] });

    const userId = await getOrCreateUserId(tgId);

    const r = await q(
      `SELECT id, title, created_at, updated_at
       FROM chat_sessions
       WHERE user_id = $1
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 50`,
      [userId],
    );

    return res.status(200).json({ ok: true, sessions: r.rows || [] });
  } catch (e) {
    console.error("[chat_sessions] error", e);
    return res.status(200).json({ ok: true, sessions: [] });
  }
}
