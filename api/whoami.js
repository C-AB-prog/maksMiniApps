// /api/whoami.js
import { requireUser } from './_utils/tg_node.js';

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  res.status(200).json({ ok: true, user });
}
