// /api/health.js
exports.config = { runtime: 'nodejs20.x' };

module.exports = async (_req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  let pool, ensureSchema;
  try {
    // ловим ошибки прямо на стадии импорта _db.js
    ({ pool, ensureSchema } = require('./_db'));
  } catch (e) {
    return res
      .status(500)
      .end(JSON.stringify({ ok: false, stage: 'require(_db)', error: e.message }));
  }

  try {
    await ensureSchema();
    await pool.query('select 1');
    return res.status(200).end(JSON.stringify({ ok: true, db: 'ok' }));
  } catch (e) {
    return res
      .status(500)
      .end(JSON.stringify({ ok: false, stage: 'query', error: e.message }));
  }
};
