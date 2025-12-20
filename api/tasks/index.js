// api/tasks/index.js
import { q, ensureSchema } from '../_db.js';
import {
  getTgId,
  getOrCreateUserId,
  userTeamIds,
  isTeamOwner,
  getUserIdByTgId,
  ensureTeamMember,
} from '../_utils.js';

function parseBool(v) {
  if (v === true || v === false) return v;
  const s = String(v || '').toLowerCase().trim();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return null;
}

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  // ---------- Список задач ----------
  if (req.method === 'GET') {
    const teams = await userTeamIds(userId);

    // фильтры (все опциональны)
    const team_id = req.query?.team_id ? Number(req.query.team_id) : null;
    const mineOnly = parseBool(req.query?.mine_only); // только личные (без team_id)
    const assignedToMe = parseBool(req.query?.assigned_to_me); // только назначенные мне
    const done = parseBool(req.query?.done); // true|false

    // Права/видимость:
    // 1) личные: user_id = me
    // 2) командные:
    //    - если assigned_to_user_id IS NULL → видят все участники команды
    //    - если assigned_to_user_id NOT NULL → видит назначенный И владелец команды
    //
    // owner команды определяем подзапросом (первый joined_at)
    //
    // Примечание: это запрос “безопасный”, но не самый лёгкий — зато он не ломает фронт и работает на 300 задач.

    const where = [];
    const params = [];
    let p = 1;

    // done filter
    if (done !== null) {
      where.push(`t.is_done = $${p++}`);
      params.push(done);
    }

    // team filter
    if (team_id) {
      // пользователь должен быть в команде или быть владельцем/создателем? (всё равно членство)
      if (!teams.includes(team_id)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
      where.push(`t.team_id = $${p++}`);
      params.push(team_id);
    }

    if (mineOnly === true) {
      where.push(`t.team_id IS NULL`);
      where.push(`t.user_id = $${p++}`);
      params.push(userId);
    } else if (assignedToMe === true) {
      where.push(`t.assigned_to_user_id = $${p++}`);
      params.push(userId);
    } else {
      // обычный режим: всё, что мне доступно
      // личные
      const myCond = `(t.team_id IS NULL AND t.user_id = $${p})`;
      params.push(userId);
      p++;

      // командные (в моих командах)
      // видимость учитывает назначение
      const teamsArr = teams.length ? teams : [0];
      const teamCond = `
        (
          t.team_id IS NOT NULL
          AND t.team_id = ANY($${p}::bigint[])
          AND (
            t.assigned_to_user_id IS NULL
            OR t.assigned_to_user_id = $${p + 1}
            OR (
              -- владелец команды видит все назначенные
              (SELECT m2.user_id
               FROM team_members m2
               WHERE m2.team_id = t.team_id
               ORDER BY m2.joined_at ASC
               LIMIT 1
              ) = $${p + 1}
            )
          )
        )
      `;
      params.push(teamsArr);
      params.push(userId);
      p += 2;

      where.push(`(${myCond} OR ${teamCond})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await q(
      `
      SELECT id, title, due_ts, is_done, created_at, team_id, assigned_to_user_id
      FROM tasks t
      ${whereSql}
      ORDER BY COALESCE(due_ts, 9223372036854775807), id DESC
      LIMIT 300
      `,
      params
    );

    return res.json({ ok: true, items: rows });
  }

  // ---------- Создание задачи ----------
  if (req.method === 'POST') {
    const title = (req.body?.title || '').trim();
    if (!title) return res.status(400).json({ ok: false, error: 'title required' });

    const due_ts = req.body?.due_ts ?? null; // ms или null
    let team_id = req.body?.team_id ? Number(req.body.team_id) : null;

    // назначение (для команды): tg_id участника, которому назначена задача
    const assigned_to_tg_id = req.body?.assigned_to_tg_id ? Number(req.body.assigned_to_tg_id) : null;
    let assigned_to_user_id = null;

    if (team_id) {
      // пользователь должен быть членом команды
      const teams = await userTeamIds(userId);
      if (!teams.includes(team_id)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }

      // если пытаемся назначить конкретному человеку — только владелец команды
      if (assigned_to_tg_id) {
        const owner = await isTeamOwner(userId, team_id);
        if (!owner) return res.status(403).json({ ok: false, error: 'only owner can assign' });

        // находим user_id по tg_id (если нет — создадим пользователя)
        assigned_to_user_id = await getUserIdByTgId(assigned_to_tg_id);
        if (!assigned_to_user_id) {
          assigned_to_user_id = await getOrCreateUserId(assigned_to_tg_id);
        }

        // проверим, что назначаемый реально в команде
        const ok = await ensureTeamMember(team_id, assigned_to_user_id);
        if (!ok) return res.status(400).json({ ok: false, error: 'assignee not in team' });
      }
    } else {
      // личная задача
      team_id = null;
      assigned_to_user_id = null;
    }

    const { rows } = await q(
      `
      INSERT INTO tasks (user_id, title, due_ts, team_id, assigned_to_user_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, title, due_ts, is_done, created_at, team_id, assigned_to_user_id
      `,
      [userId, title, due_ts, team_id, assigned_to_user_id],
    );
    return res.json({ ok: true, task: rows[0] });
  }

  return res.status(405).end();
}
