// api/_utils/db.js
import { sql } from '@vercel/postgres';

export function haveEnv() {
  return {
    has_POSTGRES_URL: !!process.env.POSTGRES_URL || !!process.env.DATABASE_URL,
    POSTGRES_URL: process.env.POSTGRES_URL || process.env.DATABASE_URL || '',
  };
}

export async function pingDb() {
  try {
    await sql`select 1 as ok`;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Упрощённый парсер userId.
// В DEV разрешаем без подписи (ALLOW_UNSIGNED=1), берём DEV_USER_ID.
// В prod берём userId из заголовка Telegram WebApp (initData) как plain-search.
export function getUserId(req) {
  const allowUnsigned = process.env.ALLOW_UNSIGNED === '1';
  const devId = process.env.DEV_USER_ID || '12345';
  const init = req.headers['x-telegram-init'] || '';

  if (allowUnsigned) return devId;

  // Пытаемся выцепить user.id из initData без верификации (минимально для MVP)
  try {
    const parts = decodeURIComponent(String(init));
    const m = parts.match(/user=(%7B.*?%7D|\{.*?\})/);
    if (m) {
      const json = decodeURIComponent(m[1]);
      const obj = JSON.parse(json);
      if (obj && obj.id) return String(obj.id);
    }
  } catch {}
  return null;
}

export default sql;
