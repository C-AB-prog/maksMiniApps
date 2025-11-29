// api/team/invite.js
import { ensureSchema } from '../_db.js';
import { getTgId, getOrCreateUserId, getOrEnsureUserTeam, baseUrlFromReq } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'GET') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  // создаём или берём первую команду пользователя
  const team = await getOrEnsureUserTeam(userId, tgId);
  const base = baseUrlFromReq(req);

  const http_link = `${base}/?join=${encodeURIComponent(team.join_token)}`;
  const BOT_USERNAME = process.env.BOT_USERNAME || '';

  const tg_link = BOT_USERNAME
    ? `https://t.me/${BOT_USERNAME}/app?startapp=join_${encodeURIComponent(team.join_token)}`
    : null;

  res.json({
    ok: true,
    team_id: team.id,
    join_code: team.join_token,
    invite_link_http: http_link,
    invite_link_tg: tg_link,
    name: team.name,          // <–– добавили имя
  });
}
