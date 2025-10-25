// api/_utils/auth.js
import crypto from 'crypto';
import { URL } from 'url';

const { BOT_TOKEN, ALLOW_UNSIGNED = '0', DEV_USER_ID } = process.env;

// валидация Telegram initData (минимальная)
function validateTelegramInitData(initDataRaw) {
  try {
    if (!initDataRaw || !BOT_TOKEN) return null;

    const parsed = Object.fromEntries(new URLSearchParams(initDataRaw));
    const hash = parsed.hash;
    if (!hash) return null;

    const dataCheckString = Object.keys(parsed)
      .filter(k => k !== 'hash')
      .sort()
      .map(k => `${k}=${parsed[k]}`)
      .join('\n');

    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calcHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

    if (calcHash !== hash) return null;

    // в user лежит json
    if (parsed.user) {
      const user = JSON.parse(parsed.user);
      if (user?.id) return { id: String(user.id) };
    }
    return null;
  } catch {
    return null;
  }
}

export async function authUser(req, res) {
  // 1) попытка через Telegram подпись
  const initData = req.headers['x-telegram-init-data'];
  const fromTg = validateTelegramInitData(initData);
  if (fromTg) return fromTg;

  // 2) dev-режим через query (?dev=dev-allow&tg_id=123)
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const dev = url.searchParams.get('dev');
    const tgId = url.searchParams.get('tg_id');
    if (dev === 'dev-allow' && tgId) {
      return { id: String(tgId) };
    }
  } catch {}

  // 3) флаг в переменных окружения (временный режим)
  if (ALLOW_UNSIGNED === '1') {
    if (DEV_USER_ID) return { id: String(DEV_USER_ID) };
    return { id: 'dev-user' }; // запасной id
  }

  // если дошли сюда — запрещаем
  res.statusCode = 401;
  res.end(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }));
  throw new Error('UNAUTHORIZED');
}
