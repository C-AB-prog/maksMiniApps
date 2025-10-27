// api/_utils.js
function json(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

// Единая идентификация пользователя:
// 1) x-telegram-id (число) -> id = tg_XXXX
// 2) x-stable-id (строка)   -> как есть
// 3) запасной cookie/fallback
function getUser(req, res) {
  const tg = (req.headers['x-telegram-id'] || '').toString().trim();
  const stable = (req.headers['x-stable-id'] || '').toString().trim();

  if (tg) return { id: `tg_${tg}`, tg_id: Number(tg) || null };
  if (stable) return { id: stable, tg_id: null };

  // старый запасной путь (если вдруг вызывают без хедеров)
  const cookies = Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.split('=').map(decodeURIComponent))
  );
  let cid = cookies.cid;
  if (!cid) {
    cid = 'anon_' + Math.random().toString(36).slice(2);
    res.setHeader('Set-Cookie', `cid=${encodeURIComponent(cid)}; Path=/; Max-Age=31536000; SameSite=Lax`);
  }
  return { id: cid, tg_id: null };
}

module.exports = { json, readBody, getUser };
