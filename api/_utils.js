// /api/_utils.js
// Авторизация без отдельного логина:
// 1) Cookie-сессия (если уже есть)
// 2) Валидный Telegram WebApp initData (подпись по "WebAppData")
// 3) МЯГКИЙ РЕЖИМ: если это Telegram WebView (по User-Agent) и в initData есть user.id,
//    принимаем пользователя даже при BAD_HASH. Можно отключить через STRICT_WEBAPP=1.
//
// Безопасность: для прод-строгого режима поставь STRICT_WEBAPP=1 в переменные окружения.

const crypto = require('crypto');

/* ---------- Cookie session (HMAC, без внешних либ) ---------- */
const SESSION_COOKIE = 'sid';
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 дней

function parseCookies(req) {
  const hdr = req.headers['cookie'] || '';
  const out = {};
  hdr.split(';').forEach(p=>{
    const [k,v] = p.split('=');
    if(!k) return;
    out[k.trim()] = decodeURIComponent((v||'').trim());
  });
  return out;
}
function signSession(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verifySession(token, secret) {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expect = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  if (sig !== expect) return null;
  try {
    const obj = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!obj || !obj.user || !obj.user.id) return null;
    if (obj.exp && Date.now()/1000 > obj.exp) return null;
    return obj;
  } catch { return null; }
}
function setSessionCookie(res, token, maxAgeSec=SESSION_TTL_SEC) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=None',
    `Max-Age=${maxAgeSec}`
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

/* ---------- Telegram WebApp initData ---------- */

// initData берём из заголовка или из ?init_data=... (если заголовки режутся)
function getInitDataFromReq(req) {
  let initDataStr = req.headers['x-telegram-init-data'] || '';
  if (!initDataStr && req.url) {
    try {
      const u = new URL(req.url, 'http://localhost');
      const q = u.searchParams.get('init_data');
      if (q) initDataStr = q;
    } catch (_) {}
  }
  return initDataStr || '';
}

// parsed: значения после decodeURIComponent; user распаршен в объект
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

// data_check_string: строим из СЫРОЙ строки (без decode), как требует Telegram
function buildDCS_WebApp(initDataStr='') {
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

function verifyWebApp(initDataStr, botToken, maxAgeSeconds=86400) {
  if (!initDataStr) return { ok:false, reason:'NO_INITDATA' };

  const parsed = parsedInitData(initDataStr);
  if (!parsed.hash) return { ok:false, reason:'NO_HASH' };
  if (!parsed.auth_date) return { ok:false, reason:'NO_AUTH_DATE' };

  const now = Math.floor(Date.now()/1000);
  const authDate = Number(parsed.auth_date);
  if (Number.isFinite(authDate) && (now - authDate) > maxAgeSeconds) {
    return { ok:false, reason:'EXPIRED' };
  }

  const dcs = buildDCS_WebApp(initDataStr);
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc   = crypto.createHmac('sha256', secret).update(dcs).digest('hex');

  const ok = (calc === parsed.hash);
  return { ok, data: parsed, reason: ok ? null : 'BAD_HASH' };
}

// грубая проверка что это Telegram WebView (для мягкого режима)
function looksLikeTelegramUA(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  return ua.includes('telegram'); // desktop/ios/android webview содержит 'Telegram'
}

/* ---------- Главная функция авторизации ---------- */

function getUserFromReq(req, botToken) {
  const strict = process.env.STRICT_WEBAPP === '1';
  const sessionSecret = process.env.SESSION_SECRET || (botToken || 'dev_secret');

  // 0) cookie-сессия
  const cookies = parseCookies(req);
  const ses = verifySession(cookies[SESSION_COOKIE], sessionSecret);
  if (ses && ses.user && ses.user.id) {
    return { ok:true, user: ses.user, source:'cookie' };
  }

  // 1) WebApp initData
  const initDataStr = getInitDataFromReq(req);
  if (initDataStr) {
    const v = verifyWebApp(initDataStr, botToken);
    if (v.ok && v.data && v.data.user && v.data.user.id) {
      return { ok:true, user: v.data.user, initData: v.data, source:'webapp_valid' };
    }

    // 1b) мягкий режим: Telegram WebView + есть user.id -> пускаем
    if (!strict && looksLikeTelegramUA(req)) {
      const p = parsedInitData(initDataStr);
      if (p && p.user && p.user.id) {
        return { ok:true, user: p.user, initData: p, source:'webapp_soft' };
      }
    }

    // подпись не прошла и мягкий режим выключён → 401 с причиной
    return {
      ok:false, status:401, error:'Unauthorized',
      reason: v.reason || 'BAD_INITDATA', hasInit:true
    };
  }

  // 2) нет initData вообще
  return { ok:false, status:401, error:'Unauthorized', reason:'NO_INITDATA', hasInit:false };
}

function sendJSON(res, status, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).end(JSON.stringify(obj));
}

module.exports = {
  // cookie helpers
  signSession, verifySession, setSessionCookie,
  // webapp
  getInitDataFromReq, parsedInitData, verifyWebApp,
  // main
  getUserFromReq, sendJSON
};
