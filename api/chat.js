// api/chat.js
// Growth Assistant — LLM-чат с инструментами и поддержкой множественных чатов

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const { text, message, tg_id, chat_id } = await readJson(req);
    const userText = (text || message || '').toString().trim();
    if (!userText) return res.status(400).json({ ok: false, error: 'Empty message' });

    const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
    const host  = (req.headers['x-forwarded-host']  || req.headers.host || '').toString();
    const baseUrl = `${proto}://${host}`;

    const tgIdHeader = (req.headers['x-tg-id'] || '').toString();
    const tgId = (tg_id || tgIdHeader || '').toString();

    // --- 0) Подтягиваем контекст пользователя: фокус и верхние задачи
    const ctx = await getContextSnapshot(baseUrl, tgId);

    // --- 1) Собираем системный промпт + сообщения
    const sys = buildSystemPrompt(ctx);
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: userText }
    ];

    // --- 2) Основной цикл: модель может вызывать функции последовательно
    const reply = await runAgent(messages, baseUrl, tgId);

    return res.status(200).json({ 
      ok: true, 
      reply: reply || 'Готово.',
      chat_id: chat_id || null
    });
  } catch (e) {
    console.error('[chat] error:', e);
    return res.status(200).json({
      ok: true,
      reply: `Я на секунду задумался 😅 Скажи, что сделать: «добавь задачу … завтра в 15:00», «фокус: …», «покажи задачи на неделю», «удали задачу …».`,
      chat_id: req.body?.chat_id || null
    });
  }
}

/* ========================= Агент ========================= */

async function runAgent(messages, baseUrl, tgId) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const model  = 'gpt-4o-mini';

  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });

  // Описание инструментов для function calling
  const tools = [
    fnDef('add_task', 'Создать новую задачу', {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Короткий заголовок задачи (≤120 символов)' },
        due_ts: { type: 'integer', description: 'Дедлайн в миллисекундах UNIX. null, если бэклог.' }
      },
      required: ['title']
    }),
    fnDef('set_focus', 'Установить или обновить фокус дня', {
      type: 'object',
      properties: { text: { type: 'string', description: 'Краткий фокус дня' } },
      required: ['text']
    }),
    fnDef('list_tasks', 'Получить задачи в заданном периоде', {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description: 'today|tomorrow|week|backlog|overdue|all'
        }
      },
      required: ['period']
    }),
    fnDef('delete_task', 'Удалить задачу по части названия', {
      type: 'object',
      properties: { query: { type: 'string', description: 'Фраза для поиска задачи' } },
      required: ['query']
    }),
    fnDef('complete_task', 'Отметить задачу выполненной по части названия', {
      type: 'object',
      properties: { query: { type: 'string', description: 'Фраза для поиска задачи' } },
      required: ['query']
    })
  ];

  // До 3 последовательных шагов инструментов
  let steps = 0;
  while (steps < 3) {
    const r = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages,
      tools,
      tool_choice: 'auto'
    });

    const msg = r.choices?.[0]?.message;
    if (!msg) break;

    // Если модель вызвала инструмент(ы)
    const calls = msg.tool_calls || [];
    if (calls.length) {
      messages.push({ role: 'assistant', tool_calls: calls, content: msg.content || '' });

      // Выполним по очереди
      for (const c of calls) {
        const name = c.function?.name;
        const args = safeParseJson(c.function?.arguments || '{}');

        let toolResult = '';
        try {
          if (name === 'add_task') {
            toolResult = await tool_add_task(baseUrl, tgId, args);
          } else if (name === 'set_focus') {
            toolResult = await tool_set_focus(baseUrl, tgId, args);
          } else if (name === 'list_tasks') {
            toolResult = await tool_list_tasks(baseUrl, tgId, args);
          } else if (name === 'delete_task') {
            toolResult = await tool_delete_task(baseUrl, tgId, args);
          } else if (name === 'complete_task') {
            toolResult = await tool_complete_task(baseUrl, tgId, args);
          } else {
            toolResult = JSON.stringify({ ok: false, error: 'Unknown tool' });
          }
        } catch (e) {
          toolResult = JSON.stringify({ ok: false, error: String(e?.message || e) });
        }

        messages.push({
          role: 'tool',
          tool_call_id: c.id,
          content: toolResult
        });
      }

      steps += 1;
      continue;
    }

    // Иначе — финальный ответ
    const final = (msg.content || '').trim();
    if (final) return tidy(final);
    break;
  }

  return `Готово. Если нужно — скажи «покажи задачи на неделю» или «добавь задачу … завтра в 10:00».`;
}

/* ========================= Инструменты ========================= */

async function tool_add_task(baseUrl, tgId, args) {
  const title = (args?.title || '').toString().slice(0, 120);
  const due_ts = Number.isFinite(args?.due_ts) ? Number(args.due_ts) : null;

  const r = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({ title, due_ts })
  });
  const j = await r.json().catch(()=> ({}));
  if (!r.ok) return JSON.stringify({ ok:false, error: j?.error || String(r.status) });

  const when = due_ts ? fmtDate(due_ts) : 'бэклог';
  return JSON.stringify({ ok:true, task: j.task || { title, due_ts }, note:`создана (${when})` });
}

async function tool_set_focus(baseUrl, tgId, args) {
  const text = (args?.text || '').toString().slice(0, 160);
  const r = await fetch(`${baseUrl}/api/focus`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({ text })
  });
  const j = await r.json().catch(()=> ({}));
  if (!r.ok) return JSON.stringify({ ok:false, error: j?.error || String(r.status) });
  return JSON.stringify({ ok:true, focus:{ text }, note: 'фокус обновлён' });
}

async function tool_list_tasks(baseUrl, tgId, args) {
  const period = normPeriod(args?.period) || 'today';
  const items = await fetchTasks(baseUrl, tgId);

  const now = Date.now();
  const range = calcRange(period);
  let filtered = items;

  if (period === 'backlog') {
    filtered = items.filter(t => t.due_ts == null);
  } else if (period === 'overdue') {
    filtered = items.filter(t => t.due_ts != null && t.due_ts < now && !t.is_done);
  } else if (range) {
    filtered = items.filter(t => t.due_ts != null && t.due_ts >= range.start && t.due_ts <= range.end);
  }

  filtered.sort((a,b)=>(a.is_done - b.is_done)||((a.due_ts ?? 1e18)-(b.due_ts ?? 1e18)));
  return JSON.stringify({ ok:true, period, items: filtered.slice(0,50) });
}

async function tool_delete_task(baseUrl, tgId, args) {
  const query = (args?.query || '').toString().toLowerCase().trim();
  const items = await fetchTasks(baseUrl, tgId);
  const matched = fuzzyFind(items, query);

  if (matched.length === 0) return JSON.stringify({ ok:false, error:'not_found' });
  if (matched.length > 1) {
    return JSON.stringify({ ok:false, error:'ambiguous', sample: matched.slice(0,5).map(t => t.title) });
  }

  const t = matched[0];
  const r = await fetch(`${baseUrl}/api/tasks/delete?id=${encodeURIComponent(t.id)}`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({})
  });
  if (!r.ok) return JSON.stringify({ ok:false, error: String(await safeErr(r)) });
  return JSON.stringify({ ok:true, deleted: t.title });
}

async function tool_complete_task(baseUrl, tgId, args) {
  const query = (args?.query || '').toString().toLowerCase().trim();
  const items = await fetchTasks(baseUrl, tgId);
  const matched = fuzzyFind(items, query);

  if (matched.length === 0) return JSON.stringify({ ok:false, error:'not_found' });
  if (matched.length > 1) {
    return JSON.stringify({ ok:false, error:'ambiguous', sample: matched.slice(0,5).map(t => t.title) });
  }

  const t = matched[0];
  const r = await fetch(`${baseUrl}/api/tasks/toggle?id=${encodeURIComponent(t.id)}`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({})
  });
  if (!r.ok) return JSON.stringify({ ok:false, error: String(await safeErr(r)) });
  return JSON.stringify({ ok:true, completed: t.title });
}

/* ========================= Контекст пользователя ========================= */

async function getContextSnapshot(baseUrl, tgId) {
  const ctx = { focus: null, tasks: [] };
  try {
    const f = await fetch(`${baseUrl}/api/focus`, { headers: headersJson(tgId) });
    if (f.ok) {
      const j = await f.json().catch(()=> ({}));
      ctx.focus = j.focus || null;
    }
  } catch {}
  try {
    const t = await fetch(`${baseUrl}/api/tasks`, { headers: headersJson(tgId) });
    if (t.ok) {
      const j = await t.json().catch(()=> ({}));
      ctx.tasks = (j.items || []).slice(0, 50);
    }
  } catch {}
  return ctx;
}

function buildSystemPrompt(ctx) {
  const focusStr = ctx.focus?.text ? `ФОКУС: ${ctx.focus.text}` : 'ФОКУС не задан';
  const topTasks = (ctx.tasks || []).slice(0, 10).map(t => {
    const due = (t.due_ts!=null) ? `до ${fmtDate(t.due_ts)}` : 'бэклог';
    const mark = t.is_done ? '✓' : '•';
    return `${mark} ${t.title} (${due})`;
  }).join('\n');

  return [
    'Ты — деловой ассистент Growth Assistant. Отвечай кратко и по делу, структурируй.',
    'Если нужно — используй функции (инструменты), чтобы создавать/показывать/закрывать/удалять задачи и изменять фокус.',
    'Формат финального ответа: 1–3 предложения + маркированный список до 5 пунктов (если уместно).',
    'Избегай воды. Предлагай конкретные сроки.',
    '',
    'Контекст пользователя:',
    focusStr,
    topTasks ? `ЗАДАЧИ:\n${topTasks}` : 'ЗАДАЧ нет',
  ].join('\n');
}

/* ========================= Утилиты ========================= */

function fnDef(name, description, parameters) {
  return { type: 'function', function: { name, description, parameters } };
}

function safeParseJson(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

function headersJson(tgId) {
  const h = { 'Content-Type': 'application/json' };
  if (tgId) h['X-TG-ID'] = String(tgId);
  return h;
}

async function readJson(req) {
  try {
    const buf = await getRawBody(req);
    return JSON.parse(buf.toString('utf8') || '{}');
  } catch { return {}; }
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function safeErr(r) {
  try { const j = await r.json(); return j?.error || `${r.status}`; }
  catch { return `${r.status}`; }
}

function startOfDay(ts) { const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
function endOfDay(ts)   { const d = new Date(ts); d.setHours(23,59,59,999); return d.getTime(); }
function addDays(ts, n) { const d = new Date(ts); d.setDate(d.getDate()+n); return d.getTime(); }

function calcRange(period) {
  const now = Date.now();
  if (period === 'today')    return { start: startOfDay(now), end: endOfDay(now) };
  if (period === 'tomorrow') { const t = addDays(now, 1); return { start: startOfDay(t), end: endOfDay(t) }; }
  if (period === 'week')     return { start: startOfDay(now), end: endOfDay(addDays(now, 7)) };
  return null;
}
function normPeriod(p) {
  const v = (p || '').toString().toLowerCase();
  if (['today','tomorrow','week','backlog','overdue','all'].includes(v)) return v;
  return 'today';
}

function fmtDate(ms) {
  try { return new Date(ms).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); }
  catch { return ''; }
}

async function fetchTasks(baseUrl, tgId) {
  const r = await fetch(`${baseUrl}/api/tasks`, { headers: headersJson(tgId) });
  if (!r.ok) throw new Error(await safeErr(r));
  const j = await r.json().catch(()=> ({}));
  return j.items || [];
}

function fuzzyFind(items, q) {
  const s = (q || '').toLowerCase();
  if (!s) return [];
  // сначала точное вхождение
  let res = items.filter(t => (t.title || '').toLowerCase().includes(s));
  if (res.length) return res;
  // по словам
  const parts = s.split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  res = items.filter(t => {
    const lt = (t.title || '').toLowerCase();
    return parts.every(p => lt.includes(p));
  });
  return res;
}

// Подчистим ответ (короткие двойные переносы и т.п.)
function tidy(s) {
  return s.replace(/\n{3,}/g, '\n\n').trim();
}
