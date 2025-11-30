// api/team/delete.js
import { getClient } from '../_db.js'; // путь такой же, как в других team-эндпойнтах

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const tgId = Number(req.headers['x-tg-id'] || 0);
  if (!tgId) {
    return res.status(401).json({ ok: false, error: 'no_tg_id' });
  }

  try {
    const { team_id, id } = req.body || {};
    const teamId = Number(team_id || id);
    if (!teamId) {
      return res.status(400).json({ ok: false, error: 'no_team_id' });
    }

    const db = await getClient();

    // находим пользователя
    const uRes = await db.query(
      'SELECT id FROM users WHERE tg_id = $1',
      [tgId]
    );
    if (!uRes.rows.length) {
      return res.status(404).json({ ok: false, error: 'user_not_found' });
    }
    const userId = uRes.rows[0].id;

    // проверяем, что он владелец команды
    const tRes = await db.query(
      'SELECT id FROM teams WHERE id = $1 AND owner_id = $2',
      [teamId, userId]
    );
    if (!tRes.rows.length) {
      return res.status(403).json({ ok: false, error: 'not_owner' });
    }

    // 1) отвязываем задачи от команды (на всякий случай, даже если FK уже ON DELETE SET NULL)
    await db.query(
      'UPDATE tasks SET team_id = NULL WHERE team_id = $1',
      [teamId]
    );

    // 2) удаляем команду — team_members уберётся через ON DELETE CASCADE
    await db.query('DELETE FROM teams WHERE id = $1', [teamId]);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[team/delete] error:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
