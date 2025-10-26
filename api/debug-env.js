// /api/debug-env.js
exports.config = { runtime: 'nodejs20.x' };

module.exports = async (_req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    has_DATABASE_URL: !!process.env.DATABASE_URL,
    has_POSTGRES_URL_NON_POOLING: !!process.env.POSTGRES_URL_NON_POOLING,
    node: process.version
  }));
};
