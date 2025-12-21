// api/team/join.js
import { ensureSchema, q } from "../_db.js";
import { getTgId, getOrCreateUserId, ensureTeamMember } from "../_utils.js";

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: "tg_id required" });

  const userId = await getOrCreateUserId(tgId);

  const token = (req.body?.token || "").toString().trim();
  if (!token) return res.status(400).json({ ok: false, error: "token required" });

  const teamR = await q(
    `SELECT id, name, join_token AS join_code
     FROM teams
     WHERE join_token = $1
     LIMIT 1`,
    [token]
  );
  if (!teamR.rows.length) return res.status(404).json({ ok: false, error: "team not found" });

  const team = teamR.rows[0];

  await ensureTeamMember(userId, team.id);

  return res.json({
    ok: true,
    team: { id: Number(team.id), name: team.name, join_code: team.join_code },
  });
}
