// api/_utils.js
import { q } from './_db.js';

export function getTgId(req) {
  const raw =
    req.headers['x-telegram-init-data'] ||
    req.headers['x-telegram-web-app-init-data'] ||
    '';

  if (raw) {
    try {
      const sp = new URLSearchParams(raw);
      const userStr = sp.get('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        if (user?.id) return Number(user.id);
      }
    } catch (_) {}
  }

  const fromQuery = Number(req.query?.tg_id || req.query?.user_id);
  if (fromQuery) return fromQuery;

  const fromHeader = Number(req.headers['x-tg-id'] || req.headers['X-TG-ID']);
  if (fromHeader) return fromHeader;

  return 0;
}

export async function getOrCreateUserId(tg_id) {
  const { rows } = await q(
    `INSERT INTO users(tg_id)
     VALUES ($1)
     ON CONFLICT (tg_id) DO UPDATE SET tg_id = EXCLUDED.tg_id
     RETURNING id`,
    [tg_id],
  );
  return rows[0].id;
}

export async function getUserIdByTgId(tgId) {
  const tgNum = Number(tgId);
  if (!tgNum) return null;
  const r = await q(`SELECT id FROM users WHERE tg_id = $1`, [tgNum]);
  return r.rows[0]?.id ? Number(r.rows[0].id) : null;
}

/* ---------- Teams helpers ---------- */

export async function userTeamIds(userId) {
  const { rows } = await q(
    `SELECT team_id FROM team_members WHERE user_id = $1`,
    [userId],
  );
  return rows.map(r => Number(r.team_id));
}

export async function ensureTeamMember(teamId, userId) {
  const m = await q(
    `SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId]
  );
  return !!m.rows.length;
}

export async function isTeamOwner(userId, teamId) {
  const own = await q(
    `
    SELECT user_id
    FROM team_members
    WHERE team_id = $1
    ORDER BY joined_at ASC
    LIMIT 1
    `,
    [teamId]
  );
  if (!own.rows.length) return false;
  return Number(own.rows[0].user_id) === Number(userId);
}

export function randomToken(len = 32) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

/**
 * Старый вариант: создаёт дефолтную команду, если нет ни одной.
 */
export async function ensureDefaultTeamForUser(userId, tgId) {
  const { rows } = await q(
    `SELECT t.id, t.join_token, t.name
     FROM teams t
     JOIN team_members m ON m.team_id = t.id
     WHERE m.user_id = $1
     ORDER BY t.id ASC
     LIMIT 1`,
    [userId],
  );
  if (rows.length) return rows[0];

  const token = randomToken(32);
  const name = `Команда ${tgId}`;
  const t = await q(
    `INSERT INTO teams(name, join_token)
     VALUES ($1, $2)
     RETURNING id, join_token, name`,
    [name, token],
  );
  const team = t.rows[0];
  await q(
    `INSERT INTO team_members(team_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [team.id, userId],
  );
  return team;
}

/**
 * Новый хелпер для invite.
 */
export async function getOrEnsureUserTeam(userId, tgId) {
  const { rows } = await q(
    `SELECT t.id, t.name, t.join_token
     FROM teams t
     JOIN team_members m ON m.team_id = t.id
     WHERE m.user_id = $1
     ORDER BY t.id ASC
     LIMIT 1`,
    [userId],
  );
  if (rows.length) return rows[0];

  const token = randomToken(32);
  const name = `Команда ${tgId}`;
  const t = await q(
    `INSERT INTO teams(name, join_token)
     VALUES ($1, $2)
     RETURNING id, name, join_token`,
    [name, token],
  );
  const team = t.rows[0];

  await q(
    `INSERT INTO team_members(team_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [team.id, userId],
  );

  return team;
}

export async function joinByToken(userId, token) {
  const { rows } = await q(
    `SELECT id FROM teams WHERE join_token = $1`,
    [token],
  );
  if (!rows.length) return null;

  const teamId = rows[0].id;
  await q(
    `INSERT INTO team_members(team_id, user_id)
     VALUES ($1,$2)
     ON CONFLICT DO NOTHING`,
    [teamId, userId],
  );
  return teamId;
}

/**
 * Для напоминаний: кто должен получить уведомление.
 * Логика:
 * - всегда автор задачи
 * - если назначена (assigned_to_user_id) — этот человек
 * - если командная задача:
 *   - владелец команды (админ) всегда получает
 *   - остальные участники получают только если задача НЕ назначена конкретному человеку
 */
export async function getTgIdsForTask(taskId) {
  const task = await q(
    `SELECT t.id, t.user_id, t.team_id, t.assigned_to_user_id
     FROM tasks t
     WHERE t.id = $1`,
    [taskId],
  );
  if (!task.rows.length) return [];

  const t = task.rows[0];
  const list = new Set();

  // автор
  const owner = await q(`SELECT tg_id FROM users WHERE id = $1`, [t.user_id]);
  owner.rows.forEach(r => list.add(Number(r.tg_id)));

  // назначенный
  if (t.assigned_to_user_id) {
    const ass = await q(`SELECT tg_id FROM users WHERE id = $1`, [t.assigned_to_user_id]);
    ass.rows.forEach(r => list.add(Number(r.tg_id)));
  }

  // команда
  if (t.team_id) {
    // админ команды (первый участник)
    const admin = await q(
      `SELECT u.tg_id
       FROM team_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.team_id = $1
       ORDER BY m.joined_at ASC
       LIMIT 1`,
      [t.team_id]
    );
    admin.rows.forEach(r => list.add(Number(r.tg_id)));

    // если задача не назначена конкретному человеку — уведомляем всех участников
    if (!t.assigned_to_user_id) {
      const members = await q(
        `SELECT u.tg_id
         FROM team_members m
         JOIN users u ON u.id = m.user_id
         WHERE m.team_id = $1`,
        [t.team_id],
      );
      members.rows.forEach(r => list.add(Number(r.tg_id)));
    }
  }

  return Array.from(list);
}

export function getBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  return `${proto}://${host}`;
}
