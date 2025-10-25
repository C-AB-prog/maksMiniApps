// /api/_utils.js
// Валидация Telegram WebApp initData без повторного stringify значений.
// data_check_string строится из сырых пар key=value (после decodeURIComponent).

const crypto = require('crypto');

// Разбор initData в два представления:
// - raw: объект со строковыми значениями как в initData (после decodeURIComponent)
// - parsed: то же, но user дополнительно распарсен в объект (для удобства)
function splitInitData(initDataStr = '') {
  const raw = {};
  for (const pair of initDataStr.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = eq >= 0 ? pair.slice(0, eq) : pair;
    const v = eq >= 0 ? pair.slice(eq + 1) : '';
    // decodeURIComponent — согласно докам Telegram
    raw[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  const parsed = { ...raw };
  if (typeof parsed.user === 'string') {
    try { parsed.user = JSON.parse(parsed.user); } catch { /* leave as string */ }
  }
  return { raw, parsed };
}

// data_check_string: сортировка по ключу, значения — ровно из raw
function buildDataCheckStringFromRaw(raw) {
  return Object.keys(raw)
    .filter((k) => k !== 'hash')
    .sort((a, b) => a.localeCompare(b))
    .map((k) => `${k}=${raw[k]}`)
    .join('\n');
}

// Основная проверка подписи. TTL по умолчанию 24 часа.
function verifyInitData(initDataStr, botToken, maxAgeSeconds = 86400) {
  if (!initDataStr) return { ok: false, reason: 'NO_INITDATA' };

  const { raw, parsed } = splitInitData(initDataStr);
  if (!raw.hash) return { ok: false, reason: 'NO_HASH' };
  if (!raw.auth_date) return { ok: false, reason: 'NO_AUTH_DATE' };

  const now = Math.floor(Date.now() / 1000);
  const authDate = Number(raw.auth_date);
  if (Number.isFinite(authDate) && now - authDate > maxAgeSeconds) {
    return { ok: false, reason: 'EXPIRED' };
  }

  const dataCheckString = buildDataCheckStringFromRaw(raw);

  // Официальная формула: secret_key = HMAC_SHA256(data=botToken, key="WebAppData")
  // Затем hash = HMAC_SHA256(data_check_string, secret_key)
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const ok = calc === raw.hash;
  return { ok, data: parsed, reason: ok ? null : 'BAD_HASH' };
}

function getUserFromReq(req, botToken) {
  const initDataStr = req.headers['x-telegram-init-data'] || '';
  const v = verifyInitData(initDataStr, botToken);

  if (!v.ok) {
    const payload = { ok: false, status: 401, error: 'Unauthorized' };
    if (process.env.DEBUG_INIT === '1') {
      payload.reason = v.reason;
      payload.hasInit = !!initDataStr;
      payload.initLen = initDataStr.length || 0;
    }
    return payload;
  }

  const user = v.data.user;
  if (!user || !user.id) {
    return { ok: false, status: 401, error: 'Unauthorized', reason: 'NO_USER' };
  }
  return { ok: true, user, initData: v.data };
}

function sendJSON(res, status, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).end(JSON.stringify(obj));
}

module.exports = {
  splitInitData,
  buildDataCheckStringFromRaw,
  verifyInitData,
  getUserFromReq,
  sendJSON
};
