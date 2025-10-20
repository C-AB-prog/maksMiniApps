// /api/chat — без зависимостей и await, ответ мгновенно
module.exports = (req, res) => {
  // CORS preflight (на будущее)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(405).json({ error: 'Use POST' });
  }

  const body = req.body || {};
  const message = String(body.message || '').toLowerCase();

  let reply = 'Я тут! Могу помочь с задачами, HADI и календарём.';
  if (/задач/.test(message)) reply = 'Перечисли задачи построчно — добавлю.';
  else if (/hadi|гипотез/.test(message)) reply = 'Формат HADI: H, A, D, I. Напиши — оформлю.';
  else if (/календар|событ/.test(message)) reply = 'Укажи дату/время — поставлю событие.';

  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({ reply });
};
