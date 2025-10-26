// /api/_utils.js — без внешних зависимостей
function json(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8') || '';
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(p => {
    const [k, ...rest] = p.trim().split('=');
    const v = rest.join('=');
    if (!k) return;
    out[k] = decodeURIComponent(v || '');
  });
  return out;
}

function serializeCookie(name, val, opt = {}) {
  let s = `${name}=${encodeURIComponent(val)}`;
  if (opt.maxAge != null) s += `; Max-Age=${Math.floor(opt.maxAge)}`;
  s += `; Path=${opt.path || '/'}`;
  if (opt.domain) s += `; Domain=${opt.domain}`;
  if (opt.expires) s += `; Expires=${opt.expires.toUTCString()}`;
  if (opt.httpOnly !== false) s += `; HttpOnly`;
  if (opt.secure !== false) s += `; Secure`;
  if (opt.sameSite) s += `; SameSite=${opt.sameSite}`;
  return s;
}

function getUser(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  let id = cookies.uid;
  if (!id) {
    id = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const c = serializeCookie('uid', id, {
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'None',
      secure: true
    });
    res.setHeader('set-cookie', c);
  }
  return { id, tg_id: null };
}

module.exports = { json, readBody, getUser };
