import { q } from './_db.js';

export function getTgId(req) {
  // 1) заголовок от Telegram WebApp
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

  // 2) на время разработки — через query или кастомный хедер
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
