// CommonJS — совместим везде
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ ok: true, time: new Date().toISOString() });
};
