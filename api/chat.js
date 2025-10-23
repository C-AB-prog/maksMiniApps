// /api/chat.js
import { requireUser } from './_utils/tg_node.js';

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { message = '' } = req.body || {};
    // ... вызов OpenAI тут ...
    res.status(200).json({ reply: `Эхо: ${message}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
