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

function safeJson(body) {
  if (body && typeof body === 'object') return body;
  try {
    return JSON.parse(body || '{}');
  } catch {
    return {};
  }
}

function normalizeDue(v) {
  if (v === null || v === undefined || v === '') return null;
  const num = Number(v);
  if (!Number.isNaN(num)) {
    const ms = num < 1e12 ? num * 1000 : num; // sec -> ms
    return ms;
  }
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

function mapTaskRow(r) {
  return {
    id: Number(r.id),
    title: r.title,
    due_ts: r.due_ts == null ? null : Number(r.due_ts),
    is_done: !!r.is_done,
    created_at: r.created_at,
    team_id: r.team_id == null ? null : Number(r.team_id),
    assigned_to_user_id: r.assigned_to_user_id == null ? null : Number(r.assigned_to_user_id),
  };
}

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });

  const userId = await getOrCreateUserId(tgId);

  // ---------- Список задач ----------
  if (req.method === 'GET') {
    const teams = await userTeamIds(userId);

    const team_id = req.query?.team_id ? Number(req.query.team_id) : null;
    const mineOnly = parseBool(req.query?.mine_only);
    const assignedToMe = parseBool(req.query?.assigned_to_me);
    const done = parseBool(req.query?.done);

    const where = [];
    const params = [];
    let p = 1;

    if (done !== null) {
      where.push(`t.is_done = $${p++}`);
      params.push(done);
    }

    if (team_id) {
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
      const myCond = `(t.team_id IS NULL AND t.user_id = $${p})`;
      params.push(userId);
      p++;

      const teamsArr = teams.length ? teams : [0];
      const teamCond = `
        (
          t.team_id IS NOT NULL
          AND t.team_id = ANY($${p}::bigint[])
          AND (
            t.assigned_to_user_id IS NULL
            OR t.assigned_to_user_id = $${p + 1}
            OR (
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

    return res.json({ ok: true, items: rows.map(mapTaskRow) });
  }

  // ---------- Создание задачи ----------
  if (req.method === 'POST') {
    const body = safeJson(req.body);

    const title = String(body?.title || '').trim();
    if (!title) return res.status(400).json({ ok: false, error: 'title required' });

    const due_ts = normalizeDue(body?.due_ts);
    let team_id = body?.team_id ? Number(body.team_id) : null;

    const assigned_to_tg_id = body?.assigned_to_tg_id ? Number(body.assigned_to_tg_id) : null;
    let assigned_to_user_id = null;

    if (team_id) {
      const teams = await userTeamIds(userId);
      if (!teams.includes(team_id)) return res.status(403).json({ ok: false, error: 'forbidden' });

      if (assigned_to_tg_id) {
        const owner = await isTeamOwner(userId, team_id);
        if (!owner) return res.status(403).json({ ok: false, error: 'only owner can assign' });

        assigned_to_user_id = await getUserIdByTgId(assigned_to_tg_id);
        if (!assigned_to_user_id) {
          assigned_to_user_id = await getOrCreateUserId(assigned_to_tg_id);
        }

        const ok = await ensureTeamMember(team_id, assigned_to_user_id);
        if (!ok) return res.status(400).json({ ok: false, error: 'assignee not in team' });
      }
    } else {
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

    return res.json({ ok: true, task: mapTaskRow(rows[0]) });
  }

  return res.status(405).end();
}
