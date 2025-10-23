// /api/whoami.js
import { requireUser } from './_utils/tg_node.js';

export default async function handler(req, res) {
  // Безопасный тест авторизации: в Dev вернёт DEV_USER_ID, в Prod — проверит подпись
  const user = await requireUser(req, res);
  if (!user) return; // уже 401
  res.status(200).json({ ok: true, user });
}
