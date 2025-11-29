import { q, ensureSchema } from '../_db.js';
import { getTgId, getOrCreateUserId, userTeamIds } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  // ---------- Список задач ----------
  if (req.method === 'GET') {
    const teams = await userTeamIds(userId);

    const { rows } = await q(
      `SELECT id, title, due_ts, is_done, created_at, team_id
       FROM tasks
       WHERE user_id = $1
          OR (team_id IS NOT NULL AND team_id = ANY($2::bigint[]))
       ORDER BY COALESCE(due_ts, 9223372036854775807), id DESC
       LIMIT 300`,
      [userId, teams.length ? teams : [0]],
    );
    return res.json({ ok: true, items: rows });
  }

  // ---------- Создание задачи ----------
  if (req.method === 'POST') {
    const title = (req.body?.title || '').trim();
    if (!title) return res.status(400).json({ ok: false, error: 'title required' });

    const due_ts = req.body?.due_ts ?? null; // ms или null
    let team_id = req.body?.team_id ? Number(req.body.team_id) : null;

    // Если явно передали team_id — проверяем, что пользователь действительно в этой команде
    if (team_id) {
      const teams = await userTeamIds(userId);
      if (!teams.includes(team_id)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
    } else {
      // Нет team_id → это личная задача
      team_id = null;
    }

    const { rows } = await q(
      `INSERT INTO tasks (user_id, title, due_ts, team_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, due_ts, is_done, created_at, team_id`,
      [userId, title, due_ts, team_id],
    );
    return res.json({ ok: true, task: rows[0] });
  }

  return res.status(405).end();
}
