// /api/chat.js
exports.config = { runtime: 'nodejs20.x' };

const { sendJSON, readJSON, getOrCreateUser } = require('./_utils');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJSON(res, 405, { error: 'Method Not Allowed' });
    }

    const { user } = getOrCreateUser(req, res);
    const body = await readJSON(req);
    const q = String(body.q || '').trim();
    if (!q) return sendJSON(res, 400, { error: 'EMPTY' });

    const key = process.env.OPENAI_API_KEY || '';
    if (!key) {
      // мягкий фолбэк без ключа, чтобы UI не «молчал»
      return sendJSON(res, 200, { a: 'LLM пока не подключён. Добавь OPENAI_API_KEY в Vercel → Settings → Environment Variables.' });
    }

    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: key });

    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Ты помогаешь ставить фокус дня, раскладывать задачи и приоритизировать. Отвечай кратко и по делу.' },
        { role: 'user', content: q }
      ],
      temperature: 0.5
    });

    const text = r.choices?.[0]?.message?.content?.trim() || '…';
    return sendJSON(res, 200, { a: text });
  } catch (e) {
    return sendJSON(res, 500, { error: e.message || String(e) });
  }
};
