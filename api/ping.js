// /api/ping — быстрый тест "жив ли бэкенд"
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ ok: true, time: new Date().toISOString() });
};
