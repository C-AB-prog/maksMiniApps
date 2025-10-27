// /api/focus.js
import { ensureSchema, q } from "./_db.js";
import { ensureUser, json } from "./_utils.js";

export async function GET(req) {
  try {
    await ensureSchema();
    const user = await ensureUser(req);
    if (!user) return json({ error: "open_via_telegram" }, 401);

    const r = await q(`SELECT text, updated_at FROM focus WHERE user_id=$1`, [user.id]);
    return json(r.rows[0] || {});
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}

export async function PUT(req) {
  try {
    await ensureSchema();
    const user = await ensureUser(req);
    if (!user) return json({ error: "open_via_telegram" }, 401);

    const body = await req.json().catch(() => ({}));
    const text = String(body.text || "").trim();
    if (!text) return json({ error: "empty" }, 400);

    await q(
      `
      INSERT INTO focus (user_id, text, updated_at)
      VALUES ($1,$2, now())
      ON CONFLICT (user_id) DO UPDATE
      SET text = EXCLUDED.text, updated_at = now()
      `,
      [user.id, text]
    );
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
