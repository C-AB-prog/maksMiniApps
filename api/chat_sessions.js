// api/chat_sessions.js
import { q, ensureSchema } from "./_db.js";
import { getTgId, getOrCreateUserId } from "./_utils.js";

export default async function handler(req, res) {
  await ensureSchema();

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const tgId = getTgId(req) || Number(req.query?.tg_id || 0);
    if (!tgId) return res.status(200).json({ ok: true, sessions: [] });

    const userId = await getOrCreateUserId(tgId);

    // ✅ Создание пустого чата (чтобы появился в списке сразу)
    if (req.method === "POST") {
      const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
      const titleRaw = (body?.title || "Новый чат").toString();
      const title = titleRaw.trim().slice(0, 80) || "Новый чат";

      const ins = await q(
        `INSERT INTO chat_sessions (user_id, title)
         VALUES ($1, $2)
         RETURNING id, title, created_at, updated_at`,
        [userId, title]
      );

      return res.status(200).json({
        ok: true,
        session: ins.rows[0],
      });
    }

    // GET список
    const r = await q(
      `SELECT id, title, created_at, updated_at
       FROM chat_sessions
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId]
    );

    return res.status(200).json({
      ok: true,
      sessions: r.rows || [],
    });
  } catch (e) {
    console.error("[chat_sessions] error", e);
    return res.status(200).json({ ok: true, sessions: [] });
  }
}
