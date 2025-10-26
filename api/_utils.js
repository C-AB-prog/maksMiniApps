// /api/_utils.js
exports.config = { runtime: 'nodejs20.x' };

const crypto = require('crypto');

// ---------- helpers ----------
function sendJSON(res, code, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(code).end(JSON.stringify(obj));
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Парсим Telegram WebApp initData (без подписи — для минимального запуска)
function parseTelegramInitData(str) {
  if (!str) return null;
  try {
    // initData — это querystring вида: "query_id=...&user=%7B...%7D&..."
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

// Простаья cookie-сессия для fallback
function getCookie(req, name) {
  const hdr = req.headers.cookie || '';
  const m = hdr.match(new RegExp('(?:^|; )' + name.replace(/([$?*|{}()\]\\/+^])/g, '\\$1') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(res, name, value, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; Expires=${expires}; SameSite=Lax`);
}

// Единый способ получить пользователя.
// 1) Пытаемся взять из Telegram initData (заголовок 'x-telegram-init-data')
// 2) Если нет — используем "временного" (cookie 'uid'), чтобы хоть что-то работало и не падало 500.
function getOrCreateUser(req, res) {
  const initData = req.headers['x-telegram-init-data'] || '';
  const tgUser = parseTelegramInitData(initData);

  if (tgUser?.id) {
    return { user: tgUser, source: 'telegram' };
  }

  // fallback — эпемерный пользователь через cookie (НЕ для прод-логина, но не даёт 500)
  let uid = getCookie(req, 'uid');
  if (!uid) {
    uid = String(10_000_000_000 + Math.floor(Math.random() * 10_000_000_000)); // псевдо-числовой id
    setCookie(res, 'uid', uid);
  }
  return { user: { id: Number(uid) }, source: 'ephemeral' };
}

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
