// api/chat.js
export const config = { runtime: 'edge' };

import { verifyTelegramInit, parseTelegramUser } from './_utils/tg.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

const systemPrompt = `
Ты — Growth Assistant. Отвечай кратко, дружелюбно и по делу.
Если запрос про задачи/фокус/календарь — используй функцию (tools) и верни действия.
Функции: add_task(title, list?, due_date?, due_time?), set_focus(text), add_event(title, date, start, dur?).
Язык ответа: русский.
`;

const tools = [
  { type:'function', function:{
    name:'add_task', description:'Добавить задачу',
    parameters:{ type:'object', properties:{
      title:{type:'string'},
      list:{type:'string', enum:['today','week','backlog']},
      due_date:{type:'string', description:'YYYY-MM-DD'},
      due_time:{type:'string', description:'HH:MM'}
    }, required:['title'] }
  }},
  { type:'function', function:{
    name:'set_focus', description:'Сохранить фокус дня',
    parameters:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] }
  }},
  { type:'function', function:{
    name:'add_event', description:'Добавить событие',
    parameters:{ type:'object', properties:{
      title:{type:'string'}, date:{type:'string'}, start:{type:'string'}, dur:{type:'number', default:60}
    }, required:['title','date','start'] }
  }},
];

export default async function handler(req) {
  if (req.method && req.method !== 'POST') return json({ error:'Use POST' }, 405);

  // 1) Проверка Telegram initData
  const initData = req.headers.get('x-telegram-init') || '';
  const botToken = process.env.BOT_TOKEN || '';
  const ok = await verifyTelegramInit(initData, botToken);
  if (!ok) return json({ error:'INVALID_TELEGRAM_SIGNATURE' }, 401);

  // 2) Пользователь из Telegram
  const user = parseTelegramUser(initData);
  const tgId = user && user.id ? String(user.id) : 'anon';

  // 3) Тело запроса
  const { message = '', history = [] } = await req.json().catch(() => ({ message:'' }));

  // 4) Запрос к OpenAI (Chat Completions + tools)
  const r = await fetch(OPENAI_URL, {
    method:'POST',
    headers:{
      'authorization': `Bearer ${process.env.OPENAI_API_KEY || ''}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      messages: [
        { role:'system', content:systemPrompt },
        ...history,
        { role:'user', content:`[tg:${tgId}] ${String(message)}` }
      ],
      tools
    })
  });

  if (!r.ok) return json({ error:'OPENAI_ERROR', detail: await safe(r) }, 502);

  const data = await r.json();
  const msg = data?.choices?.[0]?.message || {};
  const reply = msg.content || 'Готово.';
  const calls = msg.tool_calls || [];
  const actions = calls.map(tc => {
    let args={}; try{ args = JSON.parse(tc.function?.arguments || '{}') }catch{}
    return { type: tc.function?.name, args };
  });

  return json({ reply, actions });
}

function json(obj, status=200){
  return new Response(JSON.stringify(obj), {
    status,
    headers:{ 'content-type':'application/json; charset=utf-8', 'access-control-allow-origin':'*' }
  });
}
async function safe(res){ try{ return await res.json() }catch{ return { status:res.status, text:await res.text().catch(()=> '') } } }
