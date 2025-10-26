// /api/_utils.js
exports.config = { runtime: 'nodejs20.x' };

const REQUIRE_TELEGRAM = process.env.REQUIRE_TELEGRAM === '1';

// --------- helpers ----------
function sendJSON(res, code, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(code).end(JSON.stringify(obj));
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch(e) { reject(e); }
    });
  });
}

// --------- Telegram initData parser ----------
function parseTelegramInitData(str) {
  if (!str) return null;
  try {
    // initData — querystring: "query_id=...&user=%7B...%7D&..."
    const params = new URLSearchParams(str);
    const rawUser = params.get('user');
    if (!rawUser) return null;
    const user = JSON.parse(decodeURIComponent(rawUser));
    if (!user?.id) return null;
    return {
      id: Number(user.id),
      username: user.username || null,
      first_name: user.first_name || null,
      last_name: user.last_name || null,
    };
  } catch {
    return null;
  }
}

// --------- simple cookie utils ----------
function getCookie(req, name) {
  const hdr = req.headers.cookie || '';
  const m = hdr.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\\[\\]\\/\\+^])/g, '\\$1') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(res, name, value, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; Expires=${expires}; SameSite=Lax`);
}

// --------- main: getOrCreateUser ----------
function getOrCreateUser(req, res) {
  // 1) полноценное initData
  const initData = req.headers['x-telegram-init-data'] || '';
  const tgUser = parseTelegramInitData(initData);
  if (tgUser?.id) return { user: tgUser, source: 'telegram' };

  // 2) явный UID (на случай Telegram Desktop без initData)
  const hdrUid = req.headers['x-telegram-user-id'] || '';
  if (hdrUid && /^\d+$/.test(String(hdrUid))) {
    return { user: { id: Number(hdrUid) }, source: 'telegram' };
  }

  // 3) строгий режим — требуем Telegram
  if (REQUIRE_TELEGRAM) {
    const err = new Error('TELEGRAM_REQUIRED');
    err.status = 401;
    throw err;
  }

  // 4) fallback — эпемерный пользователь через cookie
  let uid = getCookie(req, 'uid');
  if (!uid) {
    uid = String(10_000_000_000 + Math.floor(Math.random() * 10_000_000_000));
    setCookie(res, 'uid', uid);
  }
  return { user: { id: Number(uid) }, source: 'ephemeral' };
}

// --------- telegram send message (optional) ----------
async function tgSendMessage(chatId, text, parse_mode = 'HTML') {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN not set' };
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode, disable_web_page_preview: true }),
    });
    return r.json();
  } catch (e) {
    return { ok: false, description: e.message };
  }
}

module.exports = { sendJSON, readJSON, getOrCreateUser, tgSendMessage };
