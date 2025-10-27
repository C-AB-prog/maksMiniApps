// api/focus.js
import { getOrCreateUser, readFocus, writeFocus } from './_db.js';
import { getUserId, json } from './_utils.js';

export default async function handler(req, res) {
  try {
    const uid = getUserId(req);
    if (!uid) return json(res, 400, { ok:false, error:'no user id' });

    await getOrCreateUser(uid);

    if (req.method === 'GET') {
      const text = await readFocus(uid);
      return json(res, 200, { ok:true, text });
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      await writeFocus(uid, body?.text ?? '');
      return json(res, 200, { ok:true });
    }

    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok:false, error:`Method ${req.method} not allowed` });
  } catch (e) {
    return json(res, 500, { ok:false, error:e.message });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data=''; req.on('data', c => data += c);
    req.on('end', () => { try{ resolve(data?JSON.parse(data):{}); } catch(e){ reject(e); } });
    req.on('error', reject);
  });
}
