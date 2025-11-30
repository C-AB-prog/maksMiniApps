// api/chat.js
// Growth Assistant — LLM-чат с хранением в БД (chat_sessions + chat_messages)

import { ensureSchema, getOrCreateUserId, q } from './_db';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    await ensureSchema();

    const tgIdHeader = (req.headers['x-tg-id'] || '').toString();
    const qsTg = (req.query?.tg_id || '').toString();
    const body = req.method === 'POST' ? await readJson(req) : {};
    const bodyTg = (body.tg_id || '').toString();

    const tgIdStr = bodyTg || tgIdHeader || qsTg;
    if (!tgIdStr) {
      return res.status(400).json({ ok: false, error: 'tg_id required' });
    }
    const tgId = Number(tgIdStr);
    const userId = await getOrCreateUserId(tgId);

    const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
    const host  = (req.headers['x-forwarded-host']  || req.headers.host || '').toString();
    const baseUrl = `${proto}://${host}`;

    if (req.method === 'GET') {
      return handleGet(req, res, userId);
    } else {
      return handlePost(req, res, userId, tgId, baseUrl, body);
    }
  } catch (e) {
    console.error('[chat] fatal error:', e);
    return res.status(200).json({
      ok: true,
      reply: 'Я на секунду задумался 😅 Скажи, что сделать: «добавь задачу … завтра в 15:00», «фокус: …», «покажи задачи на неделю», «удали задачу …».',
      chat_id: null
    });
  }
}

/* ========================= GET: list / history ========================= */

async function handleGet(req, res, userId) {
  const { history, chat_id } = req.query || {};

  // История одного чата
  if (history && chat_id) {
    const cid = Number(chat_id);
    if (!Number.isFinite(cid)) {
      return res.status(400).json({ ok: false, error: 'bad chat_id' });
    }

    const chatRow = await q(
      'SELECT id, title, created_at, updated_at FROM chat_sessions WHERE id=$1 AND user_id=$2',
      [cid, userId]
    );
    if (!chatRow.rows.length) {
      return res.status(404).json({ ok: false, error: 'chat_not_found' });
    }

    const msgs = await q(
      'SELECT role, content, created_at FROM chat_messages WHERE chat_id=$1 ORDER BY created_at ASC LIMIT 200',
      [cid]
    );

    return res.status(200).json({
      ok: true,
      chat: chatRow.rows[0],
      messages: msgs.rows
    });
  }

  // Список чатов пользователя
  const rows = await q(
    `SELECT id, title, created_at, updated_at
     FROM chat_sessions
     WHERE user_id=$1
     ORDER BY updated_at DESC
     LIMIT 100`,
    [userId]
  );

  return res.status(200).json({
    ok: true,
    chats: rows.rows
  });
}

/* ========================= POST: create / rename / delete / message ========================= */

async function handlePost(req, res, userId, tgId, baseUrl, body) {
  const { action } = body || {};

  // --- создать чат ---
  if (action === 'create') {
    const rawTitle = (body.title || '').toString().trim();
    const title = rawTitle || 'Новый чат';
    const created = await q(
      `INSERT INTO chat_sessions(user_id, title)
       VALUES ($1, $2)
       RETURNING id, title, created_at, updated_at`,
      [userId, title]
    );
    return res.status(200).json({ ok: true, chat: created.rows[0] });
  }

  // --- переименовать чат ---
  if (action === 'rename') {
    const cid = Number(body.chat_id);
    if (!Number.isFinite(cid)) {
      return res.status(400).json({ ok: false, error: 'bad chat_id' });
    }
    const rawTitle = (body.title || '').toString().trim();
    if (!rawTitle) {
      return res.status(400).json({ ok: false, error: 'empty title' });
    }
    const upd = await q(
      `UPDATE chat_sessions
       SET title=$1, updated_at=now()
       WHERE id=$2 AND user_id=$3
       RETURNING id, title, created_at, updated_at`,
      [rawTitle, cid, userId]
    );
    if (!upd.rows.length) {
      return res.status(404).json({ ok: false, error: 'chat_not_found' });
    }
    return res.status(200).json({ ok: true, chat: upd.rows[0] });
  }

  // --- удалить чат ---
  if (action === 'delete') {
    const cid = Number(body.chat_id);
    if (!Number.isFinite(cid)) {
      return res.status(400).json({ ok: false, error: 'bad chat_id' });
    }
    const del = await q(
      'DELETE FROM chat_sessions WHERE id=$1 AND user_id=$2',
      [cid, userId]
    );
    return res.status(200).json({ ok: true });
  }

  // --- обычное сообщение в чат (LLM ответ) ---
  const { text, message, chat_id } = body;
  const userText = (text || message || '').toString().trim();
  if (!userText) {
    return res.status(400).json({ ok: false, error: 'Empty message' });
  }

  // Определяем / создаём чат
  let chatId = null;
  if (chat_id != null && chat_id !== '') {
    const cid = Number(chat_id);
    if (!Number.isFinite(cid)) {
      return res.status(400).json({ ok: false, error: 'bad chat_id' });
    }
    const found = await q(
      'SELECT id FROM chat_sessions WHERE id=$1 AND user_id=$2',
      [cid, userId]
    );
    if (!found.rows.length) {
      return res.status(404).json({ ok: false, error: 'chat_not_found' });
    }
    chatId = cid;
  } else {
    // если чат не передан — создаём новый с автоназванием
    const autoTitle = userText.slice(0, 40) || 'Новый чат';
    const inserted = await q(
      `INSERT INTO chat_sessions(user_id, title)
       VALUES ($1, $2)
       RETURNING id`,
      [userId, autoTitle]
    );
    chatId = inserted.rows[0].id;
  }

  // Контекст пользователя: фокус + топ задач
  const ctx = await getContextSnapshot(baseUrl, tgId);

  // Загружаем историю чата из БД (последние N сообщений)
  const history = await q(
    `SELECT role, content
     FROM chat_messages
     WHERE chat_id=$1
     ORDER BY created_at ASC
     LIMIT 40`,
    [chatId]
  );

  const sys = buildSystemPrompt(ctx);
  const messages = [{ role: 'system', content: sys }];

  for (const row of history.rows) {
    if (row.role === 'user' || row.role === 'assistant') {
      messages.push({ role: row.role, content: row.content });
    }
  }

  messages.push({ role: 'user', content: userText });

  const reply = await runAgent(messages, baseUrl, tgId);

  // Сохраняем сообщения в БД
  await q(
    `INSERT INTO chat_messages(chat_id, role, content)
     VALUES ($1, 'user', $2), ($1, 'assistant', $3)`,
    [chatId, userText, reply || 'Готово.']
  );
  await q(
    `UPDATE chat_sessions SET updated_at=now() WHERE id=$1`,
    [chatId]
  );

  return res.status(200).json({
    ok: true,
    reply: reply || 'Готово.',
    chat_id: chatId
  });
}

/* ========================= Агент / LLM ========================= */

async function runAgent(messages, baseUrl, tgId) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const model  = 'gpt-4o-mini';

  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });

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

/* ========================= Инструменты для задач/фокуса ========================= */

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
