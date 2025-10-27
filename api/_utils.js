// api/_utils.js
// Унифицированный парсинг пользователя и ответов

export function json(res, code, data) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export function getUserId(req) {
  // всегда шлём с фронта X-User-Id (uuid в localStorage)
  const uid = req.headers['x-user-id'] || req.query.u || null;
  return typeof uid === 'string' && uid.trim() ? uid.trim() : null;
}

export function need(method, req, res) {
  if (req.method !== method) {
    res.setHeader('Allow', method);
    json(res, 405, { ok:false, error:`Method ${req.method} not allowed` });
    return false;
  }
  return true;
}
