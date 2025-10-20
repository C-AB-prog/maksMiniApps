// CommonJS-версия — без сюрпризов
module.exports = (req, res) => {
  // preflight (на будущее)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(405).json({ error: 'Use POST' });
  }

  const { message = '', user_id = 'anon' } = req.body || {};
  const text = String(message).toLowerCase();

  let reply = 'Я тут! Могу помочь с задачами, HADI и календарём.';
  if (/задач/.test(text)) reply = 'Давай: перечисли задачи построчно — добавлю.';
  else if (/hadi|гипотез/.test(text)) reply = 'Формат HADI: H, A, D, I. Напиши — оформлю.';
  else if (/календар|событ/.test(text)) reply = 'Укажи дату/время — поставлю событие.';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ reply, echo: { user_id } });
};
