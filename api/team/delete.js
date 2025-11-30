// api/team/delete.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const tgId = getTgId(req);
  if (!tgId) {
    return res.status(400).json({ ok: false, error: 'tg_id required' });
  }
  const userId = await getOrCreateUserId(tgId);

  const teamId = Number(req.body?.team_id || req.query?.team_id);
  if (!teamId) {
    return res.status(400).json({ ok: false, error: 'team_id required' });
  }

  // Удаляем только если пользователь — владелец команды
  try {
    const { rows } = await q(
      `
      DELETE FROM teams
      WHERE id = $1
        AND owner_user_id = $2
      RETURNING id
      `,
      [teamId, userId],
    );

    if (!rows.length) {
      // либо не владелец, либо команды нет
      return res.status(403).json({ ok: false, error: 'not_owner_or_not_found' });
    }

    // tasks.team_id при этом автоматически станет NULL (ON DELETE SET NULL),
    // а team_members удалятся (ON DELETE CASCADE)
    return res.json({ ok: true, team_id: rows[0].id });
  } catch (e) {
    console.error('team/delete error', e);
    return res.status(500).json({ ok: false, error: e.message || 'internal_error' });
  }
}
