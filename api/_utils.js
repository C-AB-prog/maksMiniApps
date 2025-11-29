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

  const fromHeader = Number(req.headers['x-tg-id']);
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

/* ---------- Teams helpers ---------- */
export async function userTeamIds(userId) {
  const { rows } = await q(
    `SELECT team_id FROM team_members WHERE user_id = $1`,
    [userId],
  );
  return rows.map(r => Number(r.team_id));
}

export function randomToken(len = 32) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

export async function ensureDefaultTeamForUser(userId, tgId) {
  // берём первый team пользователя, если нет — создаём
  const { rows } = await q(
    `SELECT t.id, t.join_token
     FROM teams t
     JOIN team_members m ON m.team_id = t.id
     WHERE m.user_id = $1
     ORDER BY t.id ASC
     LIMIT 1`,
    [userId],
  );
  if (rows.length) return rows[0];

  const token = randomToken(32);
  const name = `Team ${tgId}`;
  const t = await q(
    `INSERT INTO teams(name, join_token) VALUES ($1, $2) RETURNING id, join_token`,
    [name, token],
  );
  const team = t.rows[0];
  await q(`INSERT INTO team_members(team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
    team.id,
    userId,
  ]);
  return team;
}

export async function joinByToken(userId, token) {
  const { rows } = await q(`SELECT id FROM teams WHERE join_token = $1`, [token]);
  if (!rows.length) return null;
  const teamId = rows[0].id;
  await q(
    `INSERT INTO team_members(team_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [teamId, userId],
  );
  return teamId;
}

export async function getTgIdsForTask(taskId) {
  // автор
  const owner = await q(
    `SELECT u.tg_id
     FROM tasks t JOIN users u ON u.id = t.user_id
     WHERE t.id = $1`,
    [taskId],
  );

  const list = new Set(owner.rows.map(r => Number(r.tg_id)));

  // все участники команды (если командная задача)
  const team = await q(
    `SELECT t.team_id FROM tasks t WHERE t.id = $1`,
    [taskId],
  );
  if (team.rows.length && team.rows[0].team_id) {
    const members = await q(
      `SELECT u.tg_id
       FROM team_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.team_id = $1`,
      [team.rows[0].team_id],
    );
    members.rows.forEach(r => list.add(Number(r.tg_id)));
  }
  return Array.from(list);
}

export function baseUrlFromReq(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  return `${proto}://${host}`;
}
export async function createTeam(userId, tgId, name) {
  const token = randomToken(32);
  const t = await q(
    `INSERT INTO teams(name, join_token, owner_id)
     VALUES ($1, $2, $3)
     RETURNING id, name, join_token, owner_id`,
    [name || `Team ${tgId}`, token, userId],
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

export async function getUserTeams(userId) {
  const { rows } = await q(
    `SELECT t.id, t.name, t.join_token, t.owner_id
     FROM team_members m
     JOIN teams t ON t.id = m.team_id
     WHERE m.user_id = $1
     ORDER BY t.id ASC`,
    [userId],
  );
  return rows;
}

export async function isTeamOwner(userId, teamId) {
  const { rows } = await q(
    `SELECT 1 FROM teams WHERE id = $1 AND owner_id = $2`,
    [teamId, userId],
  );
  return !!rows.length;
}

export async function assertUserInTeam(userId, teamId) {
  const { rows } = await q(
    `SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId],
  );
  return !!rows.length;
}
