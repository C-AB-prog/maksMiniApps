// api/team/delete.js
import { getClient } from '../_db.js';

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

    // --- 1. находим пользователя ---
    const uRes = await db.query('SELECT id FROM users WHERE tg_id = $1', [tgId]);
    if (!uRes.rows.length) {
      return res.status(404).json({ ok: false, error: 'user_not_found' });
    }
    const userId = uRes.rows[0].id;

    // --- 2. пытаемся удалить команду, если владелец совпадает
    // или owner_id = NULL (старые команды)
    const delRes = await db.query(
      `DELETE FROM teams
       WHERE id = $1
         AND (owner_id IS NULL OR owner_id = $2)
       RETURNING id`,
      [teamId, userId]
    );

    if (!delRes.rowCount) {
      // команда есть, но удалить нельзя → скорее всего, не владелец
      const tRes = await db.query(
        'SELECT id, owner_id FROM teams WHERE id = $1',
        [teamId]
      );

      if (!tRes.rows.length) {
        return res.status(404).json({ ok: false, error: 'team_not_found' });
      }

      return res.status(403).json({ ok: false, error: 'not_owner' });
    }

    // tasks.team_id обнулится автоматически по FOREIGN KEY (ON DELETE SET NULL)
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[team/delete] error:', e);
    // Возвращаем 200 с ok:false, чтобы на фронте можно было показать нормальную ошибку
    return res.status(200).json({ ok: false, error: 'server_error' });
  }
}
