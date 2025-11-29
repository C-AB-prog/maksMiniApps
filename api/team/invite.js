// api/team/invite.js
import { ensureSchema } from '../_db.js';
import {
  getTgId,
  getOrCreateUserId,
  getBaseUrl,
  getOrEnsureUserTeam,
} from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'GET') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });

  const userId = await getOrCreateUserId(tgId);

  // либо берём существующую команду пользователя, либо создаём
  const team = await getOrEnsureUserTeam(userId, tgId);

  const base = getBaseUrl(req);
  const http_link = `${base}/?join=${encodeURIComponent(team.join_token)}`;

  res.json({
    ok: true,
    team_id: team.id,
    join_code: team.join_token,
    name: team.name,
    invite_link_http: http_link,
  });
}
