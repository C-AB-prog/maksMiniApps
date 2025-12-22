// api/team/list.js
import { q, ensureSchema } from "../_db.js";
import { getTgId, getOrCreateUserId } from "../_utils.js";

export default async function handler(req, res) {
  await ensureSchema();

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const tgId = getTgId(req) || Number(req.query?.tg_id || 0);
    if (!tgId) return res.status(200).json({ ok: true, teams: [] });

    const userId = await getOrCreateUserId(tgId);

    const r = await q(
      `
      SELECT
        t.id,
        t.name,
        t.join_token,
        t.created_at,
        (
          SELECT m2.user_id
          FROM team_members m2
          WHERE m2.team_id = t.id
          ORDER BY m2.joined_at ASC
          LIMIT 1
        ) AS owner_user_id
      FROM teams t
      JOIN team_members m ON m.team_id = t.id
      WHERE m.user_id = $1
      ORDER BY t.created_at DESC
      `,
      [userId]
    );

    const teams = r.rows.map(x => ({
      id: Number(x.id),
      name: x.name,
      join_code: x.join_token,           // ✅ фронт ждёт join_code
      is_owner: Number(x.owner_user_id) === Number(userId),
      created_at: x.created_at,
    }));

    return res.status(200).json({ ok: true, teams });
  } catch (e) {
    console.error("[team/list] error:", e);
    return res.status(200).json({ ok: true, teams: [] });
  }
}
