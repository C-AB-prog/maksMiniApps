// /api/chat.js
// POST: { text } -> вызывает OpenAI, пишет в БД ("user","assistant"), возвращает reply

import { getTgId, getChatHistory, addChatPair, ensureSchema } from './_db.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const API_KEY = process.env.OPENAI_API_KEY;

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }

    await ensureSchema();
    const tg_id = getTgId(req);
    if (!tg_id) return res.status(400).json({ ok: false, error: 'TG_ID_REQUIRED' });

    const { text } = typeof req.body === 'object' ? req.body : {};
    if (!text || !text.trim()) {
      return res.status(400).json({ ok: false, error: 'EMPTY_TEXT' });
    }

    // Тянем последние 12 сообщений для контекста
    const history = await getChatHistory(tg_id, 12);
    const messages = [
      {
        role: 'system',
        content:
          'Ты — продуктовый ассистент. Коротко и по делу. Если пользователь просит план/разбивку задач — предлагай чек-лист с сроками. Язык — русский.',
      },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ];

    let reply = '';

    if (API_KEY) {
      const resp = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: 0.3,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`OpenAI HTTP ${resp.status}: ${errText}`);
      }
      const data = await resp.json();
      reply = data?.choices?.[0]?.message?.content?.trim() || 'Готово.';
    } else {
      // Фолбэк без ключа: простая генерация
      reply = [
        'Понял задачу.',
        '1) Определи цель и срок.',
        '2) Разбей на 3–5 шагов.',
        '3) Поставь дедлайны на сегодня/неделю.',
        'Напиши «добавь: … до …», я создам задачи.',
      ].join('\n');
    }

    // Сохраняем пару (user + assistant)
    await addChatPair(tg_id, text, reply);

    return res.status(200).json({ ok: true, reply });
  } catch (e) {
    console.error('/api/chat error', e);
    return res.status(500).json({ ok: false, error: 'CHAT_FAILED' });
  }
}
