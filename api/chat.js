// /api/chat  — Vercel Edge Function with OpenAI + function calling
export const config = { runtime: 'edge' };

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini'; // быстрая и недорогая модель

const systemPrompt = `
Ты — Growth Assistant. Отвечай кратко, дружелюбно и по делу.
Если запрос про задачи/фокус/календарь — используй функцию (tools) и верни действия.
Функции: add_task(title, list?, due_date?, due_time?), set_focus(text), add_event(title, date, start, dur?).
Язык ответа: русский.
`;

const tools = [
  {
    type: 'function',
    function: {
      name: 'add_task',
      description: 'Добавить задачу в список',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          list: { type: 'string', enum: ['today','week','backlog'] },
          due_date: { type: 'string', description:'YYYY-MM-DD' },
          due_time: { type: 'string', description:'HH:MM' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_focus',
      description: 'Сохранить фокус дня',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_event',
      description: 'Создать событие в календаре',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          start: { type: 'string', description: 'HH:MM' },
          dur: { type: 'number', description: 'минуты', default: 60 }
        },
        required: ['title','date','start']
      }
    }
  }
];

export default async function handler(req) {
  if (req.method && req.method !== 'POST') {
    return json({ error: 'Use POST' }, 405);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json({ error: 'NO_OPENAI_KEY' }, 500);

  const { message = '', history = [] } = await req.json().catch(() => ({ message: '' }));
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: String(message) }
  ];

  const r = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      messages,
      tools
    })
  });

  if (!r.ok) {
    const err = await safeJson(r);
    return json({ error: 'OPENAI_ERROR', detail: err }, 502);
  }

  const data = await r.json();
  const msg = data?.choices?.[0]?.message || {};
  const reply = msg.content || 'Готово.';
  const calls = msg.tool_calls || [];
  const actions = calls.map(tc => {
    let args = {};
    try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}
    return { type: tc.function?.name, args };
  });

  return json({ reply, actions });
}

/* helpers */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*'
    }
  });
}
async function safeJson(res) {
  try { return await res.json(); } catch { return { status: res.status, text: await res.text().catch(()=> '') }; }
}
