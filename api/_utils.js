// /api/_utils.js
const crypto = require('crypto');

function parseInitData(initDataStr = '') {
  const out = {};
  for (const pair of initDataStr.split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  if (out.user) { try { out.user = JSON.parse(out.user); } catch (_) {} }
  return out;
}

function buildDataCheckString(obj) {
  return Object.entries(obj)
    .filter(([k]) => k !== 'hash')
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([k, v]) => (typeof v === 'object' && v !== null) ? `${k}=${JSON.stringify(v)}` : `${k}=${v}`)
    .join('\n');
}

function verifyInitData(initDataStr, botToken, maxAgeSeconds = 86400) {
  if (!initDataStr) return { ok:false, reason:'NO_INITDATA' };
  const data = parseInitData(initDataStr);
  if (!data.hash) return { ok:false, reason:'NO_HASH' };
  if (!data.auth_date) return { ok:false, reason:'NO_AUTH_DATE' };

  const now = Math.floor(Date.now()/1000);
  const authDate = Number(data.auth_date);
  if (Number.isFinite(authDate) && (now - authDate) > maxAgeSeconds) {
    return { ok:false, reason:'EXPIRED' };
  }

  const dataCheckString = buildDataCheckString(data);

  // Вариант A (по спецификации)
  const secretA = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hashA = crypto.createHmac('sha256', secretA).update(dataCheckString).digest('hex');

  // Вариант B (обратный порядок — встречается в некоторых реализациях)
  const secretB = crypto.createHmac('sha256', botToken).update('WebAppData').digest();
  const hashB = crypto.createHmac('sha256', secretB).update(dataCheckString).digest('hex');

  const ok = (hashA === data.hash) || (hashB === data.hash);
  return { ok, data, reason: ok ? null : 'BAD_HASH' };
}

function getUserFromReq(req, botToken) {
  const initDataStr = req.headers['x-telegram-init-data'] || '';
  const v = verifyInitData(initDataStr, botToken);
  if (!v.ok) {
    const payload = { ok:false, status:401, error:'Unauthorized' };
    if (process.env.DEBUG_INIT === '1') {
      payload.reason = v.reason; payload.hasInit = !!initDataStr; payload.initLen = initDataStr.length || 0;
    }
    return payload;
  }
  const user = v.data.user;
  if (!user || !user.id) return { ok:false, status:401, error:'Unauthorized', reason:'NO_USER' };
  return { ok:true, user, initData: v.data };
}

function sendJSON(res, status, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).end(JSON.stringify(obj));
}

module.exports = { parseInitData, buildDataCheckString, verifyInitData, getUserFromReq, sendJSON };
