// Vercel Serverless Function: /api/chat
export default function handler(req, res) {
  // простая поддержка preflight (если когда-то будешь вызывать с чужого домена)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  const { message = '', user_id = 'anon' } = req.body || {};
  const text = String(message).toLowerCase();

  let reply = 'Я тут! Могу помочь с задачами, HADI и календарём.';
  if (/задач/.test(text)) reply = 'Давай: перечисли задачи построчно — добавлю.';
  else if (/hadi|гипотез/.test(text)) reply = 'Формат HADI: H, A, D, I. Напиши — оформлю.';
  else if (/календар|событ/.test(text)) reply = 'Укажи дату/время — поставлю событие.';

  // если фронт и API будут на одном домене — CORS не нужен, но не мешает:
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({ reply, echo: { user_id } });
}
