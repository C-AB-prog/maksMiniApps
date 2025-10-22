// api/health.js
export const config = { runtime: 'nodejs' };

import { sql } from '@vercel/postgres';
import { ensureTables, verifyTelegramInit, parseTelegramUser } from './_utils/db.js';

// Вытаскиваем то, что нужно из утилит,
// если у тебя в _utils/db.js другие имена — замени импорты ниже:
export { ensureTables } from './_utils/db.js';

export default async function handler(req) {
  try {
    const init = req.headers.get('x-telegram-init') || '';
    const botToken = process.env.BOT_TOKEN || '';

    // Подпись Telegram
    let telegram_signature_ok = false;
    try { telegram_signature_ok = !!botToken && verifyTelegramInit(init, botToken); } catch {}

    // Проверка базы
    let db_ok = false;
    try { await ensureTables(); await sql`select 1`; db_ok = true; } catch {}

    const hasPg = !!process.env.POSTGRES_URL;
    const u = parseTelegramUser(init);

    return new Response(JSON.stringify({
      ok: telegram_signature_ok && db_ok,
      telegram_signature_ok,
      db_ok,
      user_id: u?.id || null,
      env: { has_POSTGRES_URL: hasPg, has_BOT_TOKEN: !!botToken }
    }), { status: 200, headers: { 'content-type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'INTERNAL_ERROR' }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
}
