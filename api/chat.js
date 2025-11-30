// api/chat.js
// Growth Assistant — LLM-чат с инструментами и поддержкой множественных чатов

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const { text, message, tg_id, chat_id, history } = await readJson(req);
    const userText = (text || message || '').toString().trim();
    if (!userText) {
      return res.status(400).json({ ok: false, error: 'Empty message' });
    }

    const proto   = (req.headers['x-forwarded-proto'] || 'https').toString();
    const host    = (req.headers['x-forwarded-host']  || req.headers.host || '').toString();
    const baseUrl = `${proto}://${host}`;

    const tgIdHeader = (req.headers['x-tg-id'] || '').toString();
    const tgId       = (tg_id || tgIdHeader || '').toString();

    // 0) контекст пользователя: фокус + задачи
    const ctx = await getContextSnapshot(baseUrl, tgId);

    // 1) системный промт
    const sys = buildSystemPrompt(ctx);

    // 2) история диалога, которую прислал фронт
    const historyMessages = Array.isArray(history)
      ? history
          .filter(
            m =>
              m &&
              (m.role === 'user' || m.role === 'assistant') &&
              typeof m.content === 'string' &&
              m.content.trim()
          )
          .slice(-16) // защитимся от слишком длинной истории
          .map(m => ({
            role: m.role,
            content: m.content.trim()
          }))
      : [];

    // 3) сообщения для модели: системка + история + текущий запрос
    const messages = [
      { role: 'system', content: sys },
      ...historyMessages,
      { role: 'user', content: userText }
    ];

    // 4) агент с tools
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
      reply:
        'Я на секунду задумался 😅 Скажи, что сделать: «добавь задачу … завтра в 15:00», «фокус: …», «покажи задачи на неделю», «удали задачу …».',
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

  const tools = [
    fnDef('add_task', 'Создать новую задачу (обычно личную, если явно не про команду)', {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'Короткий заголовок задачи (≤120 символов). Формулируй так, чтобы её было легко выполнить.'
        },
        due_ts: {
          type: 'integer',
          description:
            'Дедлайн в миллисекундах UNIX. Если нет конкретного срока — используй null (бэклог).'
        }
      },
      required: ['title']
    }),
    fnDef('set_focus', 'Установить или обновить фокус дня пользователя', {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Краткий фокус дня в 1–2 строках, без воды.'
        }
      },
      required: ['text']
    }),
    fnDef('list_tasks', 'Получить задачи за нужный период', {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description: 'Период задач: today|tomorrow|week|backlog|overdue|all'
        }
      },
      required: ['period']
    }),
    fnDef('delete_task', 'Удалить задачу по части названия', {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Фраза для поиска нужной задачи (желательно почти точное название).'
        }
      },
      required: ['query']
    }),
    fnDef('complete_task', 'Отметить задачу выполненной по части названия', {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Фраза для поиска задачи, которую нужно пометить выполненной.'
        }
      },
      required: ['query']
    })
  ];

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

    const calls = msg.tool_calls || [];
    if (calls.length) {
      messages.push({ role: 'assistant', tool_calls: calls, content: msg.content || '' });

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

    const final = (msg.content || '').trim();
    if (final) return tidy(final);
    break;
  }

  return 'Готово. Если нужно — скажи «покажи задачи на неделю» или «добавь задачу … завтра в 10:00».';
}

/* ========================= Инструменты ========================= */

async function tool_add_task(baseUrl, tgId, args) {
  const title  = (args?.title || '').toString().slice(0, 120);
  const due_ts = Number.isFinite(args?.due_ts) ? Number(args.due_ts) : null;

  const r = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({ title, due_ts })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return JSON.stringify({ ok: false, error: j?.error || String(r.status) });
  }

  const when = due_ts ? fmtDate(due_ts) : 'бэклог';
  return JSON.stringify({
    ok: true,
    task: j.task || { title, due_ts },
    note: `задача создана (срок: ${when})`
  });
}

async function tool_set_focus(baseUrl, tgId, args) {
  const text = (args?.text || '').toString().slice(0, 160);

  const r = await fetch(`${baseUrl}/api/focus`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({ text })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return JSON.stringify({ ok: false, error: j?.error || String(r.status) });
  }

  return JSON.stringify({
    ok: true,
    focus: { text },
    note: 'фокус обновлён'
  });
}

async function tool_list_tasks(baseUrl, tgId, args) {
  const period  = normPeriod(args?.period) || 'today';
  const items   = await fetchTasks(baseUrl, tgId);
  const now     = Date.now();
  const range   = calcRange(period);
  let filtered  = items;

  if (period === 'backlog') {
    filtered = items.filter(t => t.due_ts == null);
  } else if (period === 'overdue') {
    filtered = items.filter(t => t.due_ts != null && t.due_ts < now && !t.is_done);
  } else if (range) {
    filtered = items.filter(
      t => t.due_ts != null && t.due_ts >= range.start && t.due_ts <= range.end
    );
  }

  filtered.sort(
    (a, b) =>
      (a.is_done - b.is_done) || ((a.due_ts ?? 1e18) - (b.due_ts ?? 1e18))
  );

  return JSON.stringify({
    ok: true,
    period,
    items: filtered.slice(0, 50)
  });
}

async function tool_delete_task(baseUrl, tgId, args) {
  const query   = (args?.query || '').toString().toLowerCase().trim();
  const items   = await fetchTasks(baseUrl, tgId);
  const matched = fuzzyFind(items, query);

  if (matched.length === 0) {
    return JSON.stringify({ ok: false, error: 'not_found' });
  }
  if (matched.length > 1) {
    return JSON.stringify({
      ok: false,
      error: 'ambiguous',
      sample: matched.slice(0, 5).map(t => t.title)
    });
  }

  const t = matched[0];
  const r = await fetch(`${baseUrl}/api/tasks/delete?id=${encodeURIComponent(t.id)}`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({})
  });
  if (!r.ok) {
    return JSON.stringify({ ok: false, error: String(await safeErr(r)) });
  }

  return JSON.stringify({ ok: true, deleted: t.title });
}

async function tool_complete_task(baseUrl, tgId, args) {
  const query   = (args?.query || '').toString().toLowerCase().trim();
  const items   = await fetchTasks(baseUrl, tgId);
  const matched = fuzzyFind(items, query);

  if (matched.length === 0) {
    return JSON.stringify({ ok: false, error: 'not_found' });
  }
  if (matched.length > 1) {
    return JSON.stringify({
      ok: false,
      error: 'ambiguous',
      sample: matched.slice(0, 5).map(t => t.title)
    });
  }

  const t = matched[0];
  const r = await fetch(`${baseUrl}/api/tasks/toggle?id=${encodeURIComponent(t.id)}`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({})
  });
  if (!r.ok) {
    return JSON.stringify({ ok: false, error: String(await safeErr(r)) });
  }

  return JSON.stringify({ ok: true, completed: t.title });
}

/* ========================= Контекст пользователя ========================= */

async function getContextSnapshot(baseUrl, tgId) {
  const ctx = { focus: null, tasks: [] };

  try {
    const f = await fetch(`${baseUrl}/api/focus`, { headers: headersJson(tgId) });
    if (f.ok) {
      const j = await f.json().catch(() => ({}));
      ctx.focus = j.focus || null;
    }
  } catch {}

  try {
    const t = await fetch(`${baseUrl}/api/tasks`, { headers: headersJson(tgId) });
    if (t.ok) {
      const j = await t.json().catch(() => ({}));
      ctx.tasks = (j.items || []).slice(0, 50);
    }
  } catch {}

  return ctx;
}

/* ========================= Новый системный промт ========================= */

function buildSystemPrompt(ctx) {
  const now      = new Date();
  const nowRu    = now.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: 'two-digit'
  });
  const nowIso   = now.toISOString();

  const focusStr = ctx.focus?.text
    ? `ФОКУС ДНЯ: ${ctx.focus.text}`
    : 'ФОКУС ДНЯ пока не задан.';

  const topTasks = (ctx.tasks || [])
    .slice(0, 15)
    .map(t => {
      const due =
        t.due_ts != null
          ? `до ${fmtDate(t.due_ts)}`
          : 'без срока';
      const mark = t.is_done ? '✓' : '•';
      const kind = t.team_id ? ' (командная)' : '';
      return `${mark} ${t.title}${kind} — ${due}`;
    })
    .join('\n');

  const contextBlock = [
    focusStr,
    topTasks ? `ТЕКУЩИЕ ЗАДАЧИ:\n${topTasks}` : 'Задач пока нет.'
  ].join('\n');

  return [
    'Ты — умный, деловой ассистент в мини-приложении Growth Assistant.',
    'Твоя цель — помогать пользователю двигаться по делам: формулировать задачи, ставить сроки, расставлять приоритеты, работать с фокусом и планом.',
    '',
    `ТЕКУЩЕЕ ВРЕМЯ СЕРВЕРА: ${nowRu} (${nowIso}).`,
    'Считай, что это и есть реальная текущая дата и год. Если пользователь спрашивает, какой сейчас год, месяц, число или время — всегда отвечай, опираясь именно на эти значения, а не на свои старые знания.',
    'Когда нужно ставить сроки («сегодня в 12:00», «завтра в 9», «через 2 дня») — рассчитывай due_ts относительно этого времени.',
    '',
    'ОБЩИЕ ПРАВИЛА ОТВЕТА:',
    '• Отвечай на том языке, на котором пишет пользователь (если неочевидно — по умолчанию по-русски).',
    '• Пиши коротко и по делу: 1–3 абзаца + небольшой список (до 5 пунктов), только если он помогает.',
    '• Без воды: каждый ответ должен продвигать пользователя вперёд.',
    '• Всегда предлагай следующий маленький шаг, который можно сделать сегодня или в ближайшие дни.',
    '',
    'РАБОТА С КОНТЕКСТОМ И ПАМЯТЬЮ:',
    '• Учитывай в ответах текущий фокус и список задач из блока контекста ниже.',
    '• История диалога передаётся вместе с сообщениями: используй её, чтобы не задавать одни и те же вопросы и помнить, о чём говорили раньше.',
    '• Не выдумывай детали прошлой переписки, которой нет в истории.',
    '',
    'ИСПОЛЬЗОВАНИЕ ИНСТРУМЕНТОВ:',
    '• Если пользователь просит добавить/изменить/удалить задачи или фокус — используй соответствующие функции.',
    '• Перед созданием задачи или сменой фокуса убедись, что это логично вытекает из запроса. Если сомневаешься — задай 1 уточняющий вопрос.',
    '• После вызова инструмента в финальном ответе коротко напиши, что именно сделал (например: «Добавил задачу … на сегодня в 12:00»).',
    '',
    'СТИЛЬ И ТОН:',
    '• Тон — дружелюбный, спокойный, деловой. Без панибратства и без канцелярита.',
    '• Можно иногда использовать лёгкие эмодзи (до 1–3 за ответ, не обязательно).',
    '• Если запрос большой и запутанный — сначала кратко переформулируй его своими словами, затем предложи план.',
    '',
    'ПРОДУКТИВНОСТЬ:',
    '• Помогай дробить крупные цели на простые шаги-задачи.',
    '• Когда уместно, предлагай конкретные сроки и формулировки задач, которые можно создать в системе.',
    '• Если задач много — предлагай приоритизацию (важное/срочное, сегодня/неделя/месяц).',
    '',
    'ТЕКУЩИЙ КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:',
    contextBlock,
    '',
    'Всегда опирайся на этот контекст и текущее время, когда даёшь советы или работаешь с задачами.'
  ].join('\n');
}

/* ========================= Утилиты ========================= */

function fnDef(name, description, parameters) {
  return { type: 'function', function: { name, description, parameters } };
}

function safeParseJson(s) {
  try { return JSON.parse(s || '{}'); }
  catch { return {}; }
}

function headersJson(tgId) {
  const h = { 'Content-Type': 'application/json' };
  if (tgId) h['X-TG-ID'] = String(tgId);
  return h;
}

async function readJson(req) {
  try {
    const buf = await getRawBody(req);
    return JSON.parse(buf.toString('utf8') || '{}');
  } catch {
    return {};
  }
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
  try {
    const j = await r.json();
    return j?.error || `${r.status}`;
  } catch {
    return `${r.status}`;
  }
}

function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function endOfDay(ts)   { const d = new Date(ts); d.setHours(23,59,59,999); return d.getTime(); }
function addDays(ts, n) { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); }

function calcRange(period) {
  const now = Date.now();
  if (period === 'today') {
    return { start: startOfDay(now), end: endOfDay(now) };
  }
  if (period === 'tomorrow') {
    const t = addDays(now, 1);
    return { start: startOfDay(t), end: endOfDay(t) };
  }
  if (period === 'week') {
    return { start: startOfDay(now), end: endOfDay(addDays(now, 7)) };
  }
  return null;
}

function normPeriod(p) {
  const v = (p || '').toString().toLowerCase();
  if (['today', 'tomorrow', 'week', 'backlog', 'overdue', 'all'].includes(v)) return v;
  return 'today';
}

function fmtDate(ms) {
  try {
    return new Date(ms).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

async function fetchTasks(baseUrl, tgId) {
  const r = await fetch(`${baseUrl}/api/tasks`, { headers: headersJson(tgId) });
  if (!r.ok) throw new Error(await safeErr(r));
  const j = await r.json().catch(() => ({}));
  return j.items || [];
}

function fuzzyFind(items, q) {
  const s = (q || '').toLowerCase();
  if (!s) return [];
  let res = items.filter(t => (t.title || '').toLowerCase().includes(s));
  if (res.length) return res;
  const parts = s.split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  res = items.filter(t => {
    const lt = (t.title || '').toLowerCase();
    return parts.every(p => lt.includes(p));
  });
  return res;
}

function tidy(s) {
  return s.replace(/\n{3,}/g, '\n\n').trim();
}
