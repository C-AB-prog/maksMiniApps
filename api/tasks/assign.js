// api/user/profile.js
import { ensureSchema, q } from '../_db.js';
import { getTgId, getOrCreateUserId } from '../_utils.js';

export default async function handler(req, res) {
  await ensureSchema();
  if (req.method !== 'POST') return res.status(405).end();

  const tgId = getTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });
  const userId = await getOrCreateUserId(tgId);

  const username   = (req.body?.username || '').toString().slice(0, 64) || null;
  const first_name = (req.body?.first_name || '').toString().slice(0, 64) || null;
  const last_name  = (req.body?.last_name  || '').toString().slice(0, 64) || null;

  await q(
    `UPDATE users
     SET username = COALESCE($1, username),
         first_name = COALESCE($2, first_name),
         last_name  = COALESCE($3, last_name)
     WHERE id = $4`,
    [username, first_name, last_name, userId]
  );

  res.json({ ok: true });
}
