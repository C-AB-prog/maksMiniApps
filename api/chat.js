// api/chat.js
// Growth Assistant — LLM-чат с хранением в БД, привязанным к tg_id

import { ensureSchema, q } from './_db.js';
import { getTgId, getOrCreateUserId } from './_utils.js';

export default async function handler(req, res) {
  await ensureSchema();

  const tgId = getTgId(req);
  if (!tgId) {
    return res.status(400).json({ ok: false, error: 'tg_id required' });
  }
  const userId = await getOrCreateUserId(tgId);

  if (req.method === 'GET') {
    return handleGet(req, res, userId);
  }

  if (req.method === 'POST') {
    return handlePost(req, res, tgId, userId);
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}

/* ========================= GET: sessions / history ========================= */

async function handleGet(req, res, userId) {
  const mode = (req.query?.mode || 'sessions').toString();

  // Список чатов пользователя
  if (mode === 'sessions') {
    const { rows } = await q(
      `
      SELECT
        s.id,
        s.title,
        s.created_at,
        s.updated_at,
        (
          SELECT m.content
          FROM chat_messages m
          WHERE m.session_id = s.id
          ORDER BY m.id DESC
          LIMIT 1
        ) AS last_message
      FROM chat_sessions s
      WHERE s.user_id = $1
      ORDER BY s.updated_at DESC
      LIMIT 50
      `,
      [userId],
    );

    return res.json({ ok: true, sessions: rows });
  }

  // История конкретного чата
  if (mode === 'history') {
    const chatId = Number(req.query?.chat_id);
    if (!chatId) {
      return res.status(400).json({ ok: false, error: 'chat_id required' });
    }

    // проверяем, что чат принадлежит пользователю
    const own = await q(
      `SELECT 1 FROM chat_sessions WHERE id = $1 AND user_id = $2`,
      [chatId, userId],
    );
    if (!own.rows.length) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }

    const { rows } = await q(
      `
      SELECT id, role, content, created_at
      FROM chat_messages
      WHERE session_id = $1
      ORDER BY id ASC
      LIMIT 200
      `,
      [chatId],
    );

    return res.json({ ok: true, messages: rows });
  }

  return res.status(400).json({ ok: false, error: 'unknown_mode' });
}

/* ========================= POST: сообщение в чат ========================= */

async function handlePost(req, res, tgId, userId) {
  try {
    const body = await readJson(req);
    const text = (body.text || body.message || '').toString().trim();
    if (!text) {
      return res.status(400).json({ ok: false, error: 'Empty message' });
    }

    const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
    const host  = (req.headers['x-forwarded-host']  || req.headers.host || '').toString();
    const baseUrl = `${proto}://${host}`;

    let chatId = Number(body.chat_id || 0) || null;
    const explicitTitle = (body.chat_title || '').toString().trim();

    // 1) Гарантируем, что сессия существует и принадлежит пользователю
    if (chatId) {
      const own = await q(
        `SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2`,
        [chatId, userId],
      );
      if (!own.rows.length) {
        // чужой / несуществующий чат — создаём новый
        chatId = null;
      }
    }

    if (!chatId) {
      const title = explicitTitle || makeTitleFromText(text);
      const ins = await q(
        `
        INSERT INTO chat_sessions(user_id, title)
        VALUES ($1, $2)
        RETURNING id
        `,
        [userId, title],
      );
      chatId = ins.rows[0].id;
    }

    // 2) Записываем пользовательское сообщение
    await q(
      `
      INSERT INTO chat_messages(session_id, role, content)
      VALUES ($1, 'user', $2)
      `,
      [chatId, text],
    );

    // 3) Снимаем контекст задач/фокуса + историю чата из БД
    const ctx = await getContextSnapshot(baseUrl, tgId);
    const historyRows = await q(
      `
      SELECT role, content
      FROM chat_messages
      WHERE session_id = $1
      ORDER BY id ASC
      LIMIT 30
      `,
      [chatId],
    );
    const dialog = historyRows.rows.map(r => ({
      role: r.role === 'assistant' ? 'assistant' : 'user',
      content: r.content,
    }));

    // 4) Запускаем агента (LLM + функции)
    const reply = await runAgent(dialog, baseUrl, tgId, ctx);

    // 5) Сохраняем ответ ассистента
    const finalReply = reply || 'Готово.';
    await q(
      `
      INSERT INTO chat_messages(session_id, role, content)
      VALUES ($1, 'assistant', $2)
      `,
      [chatId, finalReply],
    );
    await q(
      `UPDATE chat_sessions SET updated_at = now() WHERE id = $1`,
      [chatId],
    );

    return res.json({
      ok: true,
      reply: finalReply,
      chat_id: chatId,
    });
  } catch (e) {
    console.error('[chat] error:', e);
    return res.status(200).json({
      ok: true,
      reply:
        'Я на секунду задумался 😅 Скажи, что сделать: «добавь задачу … завтра в 15:00», «фокус: …», «покажи задачи на неделю», «удали задачу …».',
      chat_id: null,
    });
  }
}

/* ========================= Агент (LLM + функции) ========================= */

async function runAgent(dialog, baseUrl, tgId, ctxFromOutside = null) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const model  = 'gpt-4o-mini';

  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });

  const ctx = ctxFromOutside || (await getContextSnapshot(baseUrl, tgId));
  const sys = buildSystemPrompt(ctx);

  // собираем сообщения: system + история из БД
  const messages = [
    { role: 'system', content: sys },
    ...dialog,
  ];

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
  const maxSteps = 3;
  const msgs = [...messages];

  while (steps < maxSteps) {
    const r = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages: msgs,
      tools,
      tool_choice: 'auto',
    });

    const msg = r.choices?.[0]?.message;
    if (!msg) break;

    const calls = msg.tool_calls || [];
    if (calls.length) {
      msgs.push({ role: 'assistant', tool_calls: calls, content: msg.content || '' });

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

        msgs.push({
          role: 'tool',
          tool_call_id: c.id,
          content: toolResult,
        });
      }

      steps += 1;
      continue;
    }

    const final = (msg.content || '').trim();
    if (final) return tidy(final);
    break;
  }

  return `Готово. Если нужно — скажи «покажи задачи на неделю» или «добавь задачу … завтра в 10:00».`;
}

/* ========================= Инструменты чата ========================= */

function headersJson(tgId) {
  const h = { 'Content-Type': 'application/json' };
  if (tgId) h['X-TG-ID'] = String(tgId);
  return h;
}

async function tool_add_task(baseUrl, tgId, args) {
  const title = (args?.title || '').toString().slice(0, 120);
  const due_ts = Number.isFinite(args?.due_ts) ? Number(args.due_ts) : null;

  const r = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({ title, due_ts }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return JSON.stringify({ ok: false, error: j?.error || String(r.status) });

  const when = due_ts ? fmtDate(due_ts) : 'бэклог';
  return JSON.stringify({ ok: true, task: j.task || { title, due_ts }, note: `создана (${when})` });
}

async function tool_set_focus(baseUrl, tgId, args) {
  const text = (args?.text || '').toString().slice(0, 160);
  const r = await fetch(`${baseUrl}/api/focus`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({ text }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return JSON.stringify({ ok: false, error: j?.error || String(r.status) });
  return JSON.stringify({ ok: true, focus: { text }, note: 'фокус обновлён' });
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
    filtered = items.filter(
      t => t.due_ts != null && t.due_ts >= range.start && t.due_ts <= range.end,
    );
  }

  filtered.sort(
    (a, b) => (a.is_done - b.is_done) || ((a.due_ts ?? 1e18) - (b.due_ts ?? 1e18)),
  );
  return JSON.stringify({ ok: true, period, items: filtered.slice(0, 50) });
}

async function tool_delete_task(baseUrl, tgId, args) {
  const query = (args?.query || '').toString().toLowerCase().trim();
  const items = await fetchTasks(baseUrl, tgId);
  const matched = fuzzyFind(items, query);

  if (matched.length === 0) return JSON.stringify({ ok: false, error: 'not_found' });
  if (matched.length > 1) {
    return JSON.stringify({
      ok: false,
      error: 'ambiguous',
      sample: matched.slice(0, 5).map(t => t.title),
    });
  }

  const t = matched[0];
  const r = await fetch(
    `${baseUrl}/api/tasks/delete?id=${encodeURIComponent(t.id)}`,
    {
      method: 'POST',
      headers: headersJson(tgId),
      body: JSON.stringify({}),
    },
  );
  const err = await safeErr(r);
  if (!r.ok) return JSON.stringify({ ok: false, error: err });
  return JSON.stringify({ ok: true, deleted: t.title });
}

async function tool_complete_task(baseUrl, tgId, args) {
  const query = (args?.query || '').toString().toLowerCase().trim();
  const items = await fetchTasks(baseUrl, tgId);
  const matched = fuzzyFind(items, query);

  if (matched.length === 0) return JSON.stringify({ ok: false, error: 'not_found' });
  if (matched.length > 1) {
    return JSON.stringify({
      ok: false,
      error: 'ambiguous',
      sample: matched.slice(0, 5).map(t => t.title),
    });
  }

  const t = matched[0];
  const r = await fetch(
    `${baseUrl}/api/tasks/toggle?id=${encodeURIComponent(t.id)}`,
    {
      method: 'POST',
      headers: headersJson(tgId),
      body: JSON.stringify({}),
    },
  );
  const err = await safeErr(r);
  if (!r.ok) return JSON.stringify({ ok: false, error: err });
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

function buildSystemPrompt(ctx) {
  const focusStr = ctx.focus?.text ? `ФОКУС: ${ctx.focus.text}` : 'ФОКУС не задан';
  const topTasks = (ctx.tasks || [])
    .slice(0, 10)
    .map(t => {
      const due = t.due_ts != null ? `до ${fmtDate(t.due_ts)}` : 'бэклог';
      const mark = t.is_done ? '✓' : '•';
      return `${mark} ${t.title} (${due})`;
    })
    .join('\n');

  return [
    'Ты — деловой ассистент Growth Assistant в Telegram Mini App.',
    'Отвечай по-деловому, дружелюбно, но без воды.',
    'Структура ответа: 1–3 предложения + при необходимости маркированный список до 5 пунктов.',
    'Если пользователь просит создать / изменить задачи или фокус — используй инструменты.',
    'Обязательно учитывай контекст: текущий фокус и верхние задачи.',
    'Если пользователь говорит «сделай напоминание», «создай задачу к вечеру» и т.п. — сам предлагай конкретное время.',
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

function safeParseJson(s) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
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

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function endOfDay(ts) {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
function addDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

function calcRange(period) {
  const now = Date.now();
  if (period === 'today') return { start: startOfDay(now), end: endOfDay(now) };
  if (period === 'tomorrow') {
    const t = addDays(now, 1);
    return { start: startOfDay(t), end: endOfDay(t) };
  }
  if (period === 'week') return { start: startOfDay(now), end: endOfDay(addDays(now, 7)) };
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
      minute: '2-digit',
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

function makeTitleFromText(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return 'Новый чат';
  if (t.length <= 40) return t;
  return t.slice(0, 37) + '…';
}
