// api/team/join.js
import { q, ensureSchema } from "../_db.js";
import { getTgId, getOrCreateUserId } from "../_utils.js";

export default async function handler(req, res) {
  await ensureSchema();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const tgId = getTgId(req);
    if (!tgId) return res.status(401).json({ ok: false, error: "tg_id_required" });

    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const token = String(body?.token || "").trim();
    if (!token) return res.status(400).json({ ok: false, error: "token_required" });

    const userId = await getOrCreateUserId(tgId);

    // В БД актуальное поле: join_token.
    const teamR = await q(
      `SELECT id, name, join_token
       FROM teams
       WHERE join_token = $1
       LIMIT 1`,
      [token]
    );

    if (!teamR.rows.length) {
      return res.status(404).json({ ok: false, error: "team_not_found" });
    }

    const team = teamR.rows[0];

    await q(
      `INSERT INTO team_members(team_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (team_id, user_id) DO NOTHING`,
      [team.id, userId]
    );

    return res.status(200).json({
      ok: true,
      team: {
        id: Number(team.id),
        name: team.name,
        join_code: team.join_token,
      },
    });
  } catch (e) {
    console.error("[team/join] error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
