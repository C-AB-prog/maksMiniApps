// api/[...slug].js
import { json } from './_utils.js';
export default function handler(req, res) {
  json(res, 404, { ok:false, error:'Not found', path: req.url, method: req.method });
}
