// /api/_utils.js

function json(res, data, status = 200, headers = {}) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(body);
}

function parseCookies(req) {
  const hdr = req.headers.cookie || '';
  const out = {};
  hdr.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1));
  });
  return out;
}

function uid() {
  return 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getUser(req, res) {
  const cookies = parseCookies(req);
  let id = cookies.uid;
  if (!id) {
    id = uid();
    // год
    res.setHeader(
      'Set-Cookie',
      `uid=${encodeURIComponent(id)}; Path=/; Max-Age=${3600 * 24 * 365}; SameSite=Lax`
    );
  }
  return { id, tg_id: null };
}

async function readBody(req) {
  let data = '';
  await new Promise((resolve, reject) => {
    req.on('data', c => (data += c));
    req.on('end', resolve);
    req.on('error', reject);
  });

  if (!data) return {};
  const ctype = (req.headers['content-type'] || '').toLowerCase();

  if (ctype.includes('application/json')) {
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  if (ctype.includes('application/x-www-form-urlencoded')) {
    const o = {};
    data.split('&').forEach(p => {
      const [k, v = ''] = p.split('=');
      o[decodeURIComponent(k)] = decodeURIComponent(v);
    });
    return o;
  }
  return { raw: data };
}

module.exports = { json, getUser, readBody };
