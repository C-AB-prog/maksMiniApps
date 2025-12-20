// api/team/delete.js
// Расформировать команду (только владелец: первый участник team_members)

import { ensureSchema, q } from "../_db.js";
import { getTgId, getOrCreateUserId } from "../_utils.js";

export default async function handler(req, res) {
  await ensureSchema();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const tgId = getTgId(req);
    if (!tgId) return res.status(400).json({ ok: false, error: "tg_id required" });

    const userId = await getOrCreateUserId(tgId);

    const teamId = Number(req.body?.team_id || 0);
    if (!teamId) return res.status(400).json({ ok: false, error: "team_id required" });

    // владелец = первый joined_at
    const own = await q(
      `
      SELECT user_id
      FROM team_members
      WHERE team_id = $1
      ORDER BY joined_at ASC
      LIMIT 1
      `,
      [teamId],
    );

    if (!own.rows.length) return res.status(404).json({ ok: false, error: "not_found" });
    if (Number(own.rows[0].user_id) !== Number(userId)) {
      return res.status(403).json({ ok: false, error: "only owner can delete" });
    }

    const del = await q("DELETE FROM teams WHERE id = $1 RETURNING id", [teamId]);
    if (!del.rows.length) return res.status(404).json({ ok: false, error: "not_found" });

    // team_members удалятся по ON DELETE CASCADE
    // tasks.team_id станет NULL по ON DELETE SET NULL (у тебя так в схеме)

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[team/delete] error", e);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
}
