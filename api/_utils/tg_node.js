// /api/_utils/tg_node.js
import crypto from 'crypto';
import { sql } from '@vercel/postgres';
import { ensureTables } from './schema.js';

const BOT_TOKEN = process.env.BOT_TOKEN;

/**
 * Проверка подписи Telegram WebApp.
 * Возвращает объект user {id, username, ...} или null.
 */
function verifyInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;

  const url = new URLSearchParams(initData);
  const hash = url.get('hash');
  if (!hash) return null;

  // формируем data_check_string
  const pairs = [];
  for (const [k, v] of url.entries()) {
    if (k === 'hash') continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  // секрет = HMAC-SHA256(SHA256("WebAppData"+BOT_TOKEN), data_check_string)
  const secret = crypto.createHash('sha256')
    .update('WebAppData' + BOT_TOKEN)
    .digest();
  const calc = crypto.createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');

  if (calc !== hash) return null;

  // парсим user
  const userRaw = url.get('user');
  if (!userRaw) return null;
  const user = JSON.parse(userRaw);
  if (!user?.id) return null;
  return user;
}

/**
 * Достаёт пользователя из заголовка X-Telegram-Init-Data.
 * В DEV-режиме можно разрешить фолбэк (строго не в проде).
 */
export async function requireUser(req, res) {
  const initHeader = req.headers['x-telegram-init-data'];
  const user = verifyInitData(initHeader);

  if (!user) {
    // Разрешать без подписи ТОЛЬКО если явно включён превью/дев и переменная включена
    if (process.env.VERCEL_ENV !== 'production' && process.env.ALLOW_UNSIGNED === '1') {
      const devId = Number(process.env.DEV_USER_ID || 9999);
      return { id: devId, username: 'dev' };
    }
    res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    return null;
  }

  // лениво регистрируем user в БД (таблица users)
  await ensureTables();
  await sql`
    INSERT INTO users (id, username)
    VALUES (${user.id}, ${user.username || null})
    ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
  `;
  return { id: user.id, username: user.username || null };
}
