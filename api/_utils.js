// /api/_utils.js
const crypto = require('crypto');

function getInitDataFromReq(req) {
  let initDataStr = req.headers['x-telegram-init-data'] || '';
  if (!initDataStr && req.url) {
    try {
      const u = new URL(req.url, 'http://localhost');
      const q = u.searchParams.get('init_data');
      if (q) initDataStr = q; // уже «сырая» строка initData от Telegram
    } catch (_) {}
  }
  return initDataStr || '';
}

// parsed: значения декодированы, user распарсен для удобства
function parsedInitData(initDataStr='') {
  const obj = {};
  for (const part of initDataStr.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = i>=0 ? part.slice(0,i) : part;
    const v = i>=0 ? part.slice(i+1) : '';
    obj[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  if (typeof obj.user === 'string') { try { obj.user = JSON.parse(obj.user); } catch {} }
  return obj;
}

// data_check_string: из «сырой» строки, без decode
function buildDataCheckStringRaw(initDataStr='') {
  const pairs = [];
  for (const part of initDataStr.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = i>=0 ? part.slice(0,i) : part;
    if (k === 'hash') continue;
    const v = i>=0 ? part.slice(i+1) : '';
    pairs.push([k, v]);
  }
  pairs.sort((a,b)=> a[0].localeCompare(b[0]));
  return pairs.map(([k,v])=> `${k}=${v}`).join('\n');
}

function verifyInitData(initDataStr, botToken, maxAgeSeconds = 86400) {
  if (!initDataStr) return { ok:false, reason:'NO_INITDATA' };

  const parsed = parsedInitData(initDataStr);
  if (!parsed.hash) return { ok:false, reason:'NO_HASH' };
  if (!parsed.auth_date) return { ok:false, reason:'NO_AUTH_DATE' };

  const now = Math.floor(Date.now()/1000);
  const authDate = Number(parsed.auth_date);
  if (Number.isFinite(authDate) && (now - authDate) > maxAgeSeconds) {
    return { ok:false, reason:'EXPIRED' };
  }

  const dcs = buildDataCheckStringRaw(initDataStr);
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc   = crypto.createHmac('sha256', secret).update(dcs).digest('hex');

  const ok = (calc === parsed.hash);
  return { ok, data: parsed, reason: ok ? null : 'BAD_HASH' };
}

function getUserFromReq(req, botToken) {
  const initDataStr = getInitDataFromReq(req);
  const v = verifyInitData(initDataStr, botToken);
  if (!v.ok) {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized',
      reason: v.reason,
      hasInit: !!initDataStr,
      initLen: initDataStr.length || 0
    };
  }
  const user = v.data.user;
  if (!user || !user.id) {
    return { ok:false, status:401, error:'Unauthorized', reason:'NO_USER' };
  }
  return { ok:true, user, initData: v.data };
}

function sendJSON(res, status, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).end(JSON.stringify(obj));
}

module.exports = {
  getInitDataFromReq,
  parsedInitData,
  buildDataCheckStringRaw,
  verifyInitData,
  getUserFromReq,
  sendJSON
};
