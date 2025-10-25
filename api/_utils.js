const crypto = require('crypto');

function parseInitData(initDataStr = '') {
  // initData — это querystring вида key=value&key2=value2...
  const out = {};
  for (const pair of initDataStr.split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  // распарсим user (JSON-строка)
  if (out.user) {
    try { out.user = JSON.parse(out.user); } catch (_) {}
  }
  return out;
}

function buildDataCheckString(obj) {
  // исключаем 'hash', сортируем по ключу, соединяем через \n
  const entries = Object.entries(obj)
    .filter(([k]) => k !== 'hash')
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([k, v]) => {
      if (typeof v === 'object' && v !== null) v = JSON.stringify(v);
      return `${k}=${v}`;
    });
  return entries.join('\n');
}

function verifyInitData(initDataStr, botToken, maxAgeSeconds = 86400) {
  if (!initDataStr) return { ok: false, reason: 'NO_INITDATA' };
  const data = parseInitData(initDataStr);
  if (!data.hash) return { ok: false, reason: 'NO_HASH' };
  if (!data.auth_date) return { ok: false, reason: 'NO_AUTH_DATE' };

  // TTL check
  const now = Math.floor(Date.now()/1000);
  const authDate = Number(data.auth_date);
  if (Number.isFinite(authDate) && (now - authDate) > maxAgeSeconds) {
    return { ok: false, reason: 'EXPIRED' };
  }

  // secret_key = HMAC_SHA256( bot_token, key="WebAppData" )
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  // hash_check = HMAC_SHA256( data_check_string, key=secretKey )
  const dataCheckString = buildDataCheckString(data);
  const calculated = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const ok = (calculated === data.hash);
  return { ok, data, reason: ok ? null : 'BAD_HASH' };
}

function getUserFromReq(req, botToken) {
  const initDataStr = req.headers['x-telegram-init-data'] || '';
  const v = verifyInitData(initDataStr, botToken);
  if (!v.ok) return { ok: false, status: 401, error: 'Unauthorized: ' + v.reason };
  const user = v.data.user;
  if (!user || !user.id) return { ok: false, status: 401, error: 'Unauthorized: NO_USER' };
  return { ok: true, user, initData: v.data };
}

function sendJSON(res, status, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).end(JSON.stringify(obj));
}

module.exports = {
  parseInitData,
  verifyInitData,
  getUserFromReq,
  sendJSON
};
