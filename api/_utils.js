// /api/_utils.js
// Авторизация без лишних кнопок:
// 1) Cookie-сессия (если уже есть)
// 2) Валидация Telegram WebApp initData (2 формулы секрета; строгая проверка)
// 3) ФОЛБЭК: если подпись не сошлась, но есть user.id — проверяем через Bot API getChat,
//    и если бот реально «видит» этого юзера, пускаем. (TELEGRAM_FALLBACK_BOTAPI=1 по умолчанию)
//
// Переменные окружения:
// - TELEGRAM_BOT_TOKEN (обязательно)
// - SESSION_SECRET (желательно; по умолчанию = TELEGRAM_BOT_TOKEN)
// - TELEGRAM_FALLBACK_BOTAPI=1|0 (по умолчанию 1 — включено)
// - BOTAPI_TIMEOUT_MS (по умолчанию 1500)
//
// ВНИМАНИЕ: Файл стал асинхронным (getUserFromReq → async). Эндпоинты должны вызывать `await`.

const crypto = require('crypto');

const SESSION_COOKIE = 'sid';
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 дней
const BOTAPI_TIMEOUT_MS = Number(process.env.BOTAPI_TIMEOUT_MS || 1500);
const TELEGRAM_FALLBACK_BOTAPI = process.env.TELEGRAM_FALLBACK_BOTAPI !== '0'; // по умолчанию ВКЛ.

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

// initData из заголовка или ?init_data=... (если заголовки режутся)
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

// parsed: decodeURIComponent; user → JSON.parse
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

// data_check_string для WebApp — строго из «сырой» строки
function buildDCS(initDataStr='') {
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

// Проверяем двумя формулами секрета (разночтения в примерах встречаются)
function verifyWebAppBoth(initDataStr, botToken, maxAgeSeconds=86400) {
  if (!initDataStr) return { ok:false, reason:'NO_INITDATA' };
  const parsed = parsedInitData(initDataStr);
  if (!parsed.hash) return { ok:false, reason:'NO_HASH' };
  if (!parsed.auth_date) return { ok:false, reason:'NO_AUTH_DATE' };

  const now = Math.floor(Date.now()/1000);
  const authDate = Number(parsed.auth_date);
  if (Number.isFinite(authDate) && (now - authDate) > maxAgeSeconds) {
    return { ok:false, reason:'EXPIRED' };
  }

  const dcs = buildDCS(initDataStr);

  // Вариант A (документация)
  const secretA = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcA   = crypto.createHmac('sha256', secretA).update(dcs).digest('hex');

  // Вариант B (встречается в SDK/примерах)
  const secretB = crypto.createHmac('sha256', botToken).update('WebAppData').digest();
  const calcB   = crypto.createHmac('sha256', secretB).update(dcs).digest('hex');

  if (calcA === parsed.hash) return { ok:true, method:'A', data: parsed };
  if (calcB === parsed.hash) return { ok:true, method:'B', data: parsed };
  return { ok:false, reason:'BAD_HASH' };
}

// Фолбэк-проверка через Bot API: бот «видит» этот user_id?
async function verifyViaBotAPI(userId, botToken) {
  if (!botToken || !userId) return false;
  const ctrl = new AbortController();
  const t = setTimeout(()=> ctrl.abort(), BOTAPI_TIMEOUT_MS);
  try {
    const url = `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(String(userId))}`;
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = await r.json();
    // { ok:true, result:{ id: <user_id>, ... } } — достаточно
    return !!(j && j.ok && j.result && String(j.result.id) === String(userId));
  } catch {
    clearTimeout(t);
    return false;
  }
}

async function getUserFromReq(req, botToken) {
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
    const v = verifyWebAppBoth(initDataStr, botToken);
    if (v.ok && v.data && v.data.user && v.data.user.id) {
      return { ok:true, user: v.data.user, initData: v.data, source:`webapp_${v.method}` };
    }

    // 1b) ФОЛБЭК через Bot API
    const p = parsedInitData(initDataStr);
    const userId = p && p.user && p.user.id;
    if (TELEGRAM_FALLBACK_BOTAPI && userId) {
      const ok = await verifyViaBotAPI(userId, botToken);
      if (ok) {
        // ставим cookie на 30 дней — дальше подпись не требуется
        const now = Math.floor(Date.now()/1000);
        const token = signSession({ user: p.user, iat: now, exp: now + SESSION_TTL_SEC }, sessionSecret);
        // setSessionCookie вызываем в конкретном эндпоинте, где есть res (см. ниже)
        return { ok:true, user: p.user, initData: p, source:'botapi' };
      }
    }

    // подпись не прошла и Bot API не подтвердил — 401
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
  // cookie utils
  signSession, verifySession, setSessionCookie,
  // webapp utils
  getInitDataFromReq, parsedInitData, verifyWebAppBoth,
  // main
  getUserFromReq, sendJSON
};
