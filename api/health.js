// /api/health.js
exports.config = { runtime: 'nodejs20.x' };

const { pool, ensureSchema } = require('./_db');

module.exports = async (_req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    await ensureSchema();
    await pool.query('select 1');
    res.status(200).end(JSON.stringify({ ok: true, db: 'ok' }));
  } catch (e) {
    res.status(500).end(JSON.stringify({ ok: false, error: e.message || String(e) }));
  }
};
