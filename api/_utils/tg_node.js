// /api/_utils/tg_node.js
import crypto from 'crypto';

/** Разбор initData, приходит строкой вида "user=...&chat_instance=...&hash=..." */
function parseInitData(initData) {
  const sp = new URLSearchParams(initData || '');
  const hash = sp.get('hash');
  sp.delete('hash');
  const data = {};
  for (const [k, v] of sp.entries()) data[k] = v;
  return { hash, data };
}

/** Верификация подписи по документации Telegram Web Apps */
function checkSignature(initData, botToken) {
  const { hash, data } = parseInitData(initData);
  if (!hash || !botToken) return { ok: false, data };

  const dataCheckString = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(botToken).digest(); // HMAC key
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return { ok: hmac === hash, data };
}

function getUserIdFromData(data) {
  try {
    // поле user — JSON строка с объектом Telegram WebApp initData.user
    const u = JSON.parse(data.user);
    return u && typeof u.id === 'number' ? u.id : null;
  } catch {
    return null;
  }
}

/**
 * В dev-режиме (ALLOW_UNSIGNED=1) вернёт DEV_USER_ID.
 * В проде требует валидный x-telegram-init (+ BOT_TOKEN) — иначе ответ 401.
 * Возвращает объект { id, dev?: true } или null (если уже отправлен 401).
 */
export async function requireUser(req, res) {
  // DEV: позволяем работать без подписи
  if (process.env.ALLOW_UNSIGNED === '1' && process.env.DEV_USER_ID) {
    return { id: Number(process.env.DEV_USER_ID), dev: true };
  }

  const init = req.headers['x-telegram-init'] || req.headers['x-telegram-init-data'] || '';
  if (!init || !process.env.BOT_TOKEN) {
    res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    return null;
  }

  const { ok, data } = checkSignature(init, process.env.BOT_TOKEN);
  if (!ok) {
    res.status(401).json({ ok: false, error: 'BAD_SIGNATURE' });
    return null;
  }
  const uid = getUserIdFromData(data);
  if (!uid) {
    res.status(401).json({ ok: false, error: 'NO_USER' });
    return null;
  }
  return { id: Number(uid) };
}
