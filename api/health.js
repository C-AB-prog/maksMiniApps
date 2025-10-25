// /api/health.js
const { pool, ensureSchema } = require('./_db');

module.exports = async (req, res) => {
  try {
    await ensureSchema();
    await pool.query('SELECT 1');
    res.setHeader('Content-Type','application/json');
    res.status(200).end(JSON.stringify({ ok:true }));
  } catch (e) {
    res.status(500).end(JSON.stringify({ ok:false, error:e.message }));
  }
};
