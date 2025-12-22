// api/chat.js
// LLM-чат с хранением в БД и инструментами (фокус, задачи)

import OpenAI from 'openai';

import { ensureSchema, q } from './_db.js';
import { getTgId, getOrCreateUserId, getBaseUrl } from './_utils.js';

/* ============ helpers ============ */

function safeJson(body) {
  if (body && typeof body === 'object') return body;
  try {
    return JSON.parse(body || '{}');
  } catch {
    return {};
  }
}

function headersJson(tgId) {
  const h = { 'Content-Type': 'application/json' };
  if (tgId) h['X-TG-ID'] = String(tgId);
  return h;
}

function normalizeDue(v) {
  if (v === null || v === undefined) return null;
  const num = Number(v);
  if (!Number.isNaN(num)) {
    const ms = num < 1e12 ? num * 1000 : num;
    return ms;
  }
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

function fmtDate(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function getContextSnapshot(baseUrl, tgId) {
  const ctx = { focus: null, tasks: [] };
  try {
    const f = await fetch(`${baseUrl}/api/focus?tg_id=${encodeURIComponent(tgId)}`, {
      headers: headersJson(tgId),
    });
    if (f.ok) {
      const j = await f.json().catch(() => ({}));
      ctx.focus = j.focus || null;
    }
  } catch {}
  try {
    const t = await fetch(`${baseUrl}/api/tasks?tg_id=${encodeURIComponent(tgId)}`, {
      headers: headersJson(tgId),
    });
    if (t.ok) {
      const j = await t.json().catch(() => ({}));
      ctx.tasks = (j.items || []).slice(0, 60);
    }
  } catch {}
  return ctx;
}

/**
 * Бизнес-ассистент + продуктивность.
 */
function buildSystemPrompt(ctx) {
  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);

  const focusStr = ctx.focus?.text
    ? `ФОКУС СЕГОДНЯ: ${ctx.focus.text}`
    : `ФОКУС СЕГОДНЯ не задан.`;

  const tasks = (ctx.tasks || []).slice(0, 14).map(t => {
    const ms = normalizeDue(t.due_ts);
    const due = ms ? `до ${fmtDate(ms)}` : 'без срока';
    const mark = t.is_done ? '✓' : '•';
    const team = t.team_id ? ' [команда]' : '';
    const assigned = t.assigned_to_username
      ? ` [→ @${t.assigned_to_username}]`
      : (t.assigned_to_user_id ? ' [назначено]' : '');
    return `${mark} ${t.title} (${due})${team}${assigned}`;
  }).join('\n');

  return [
    `Ты — Growth Assistant: сильный практичный ассистент предпринимателя.`,
    `Твоя задача — помогать пользователю расти: продукт, продажи, маркетинг, финансы, найм, процессы.`,
    ``,
    `Сегодня: ${todayISO}. Любые "сегодня/завтра/через неделю" считай относительно этой даты.`,
    ``,
    `Стиль ответа:`,
    `- По делу. Сначала 2–4 предложения сути, затем структурированный план (3–8 пунктов).`,
    `- Если данных не хватает — задай ОДИН уточняющий вопрос (максимум один).`,
    `- Давай конкретные действия: что сделать сегодня/за 60 минут/за неделю.`,
    ``,
    `Инструменты (tasks/focus):`,
    `- Используй инструменты ТОЛЬКО когда пользователь явно просит: добавить/удалить/закрыть задачу, показать задачи, поставить фокус.`,
    `- Не превращай каждый бизнес-разбор в задачи автоматически. Предлагай — но не навязывай.`,
    ``,
    `Контекст пользователя (для справки):`,
    focusStr,
    tasks ? `ЗАДАЧИ (верхние):\n${tasks}` : 'ЗАДАЧ нет.',
  ].join('\n');
}

/* ====== инструменты через /api/tasks и /api/focus ===== */

async function tool_add_task(baseUrl, tgId, args) {
  const title = (args?.title || '').toString().slice(0, 200);
  const due_ts = typeof args?.due_ts === 'number' ? args.due_ts : null;

  const r = await fetch(`${baseUrl}/api/tasks?tg_id=${encodeURIComponent(tgId)}`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({ title, due_ts }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) {
    return { ok: false, error: j?.error || `HTTP ${r.status}` };
  }
  const when = due_ts ? fmtDate(due_ts) : 'без срока';
  return { ok: true, note: `задача создана (до ${when})` };
}

async function tool_set_focus(baseUrl, tgId, args) {
  const text = (args?.text || '').toString().slice(0, 200);
  const r = await fetch(`${baseUrl}/api/focus?tg_id=${encodeURIComponent(tgId)}`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({ text }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) {
    return { ok: false, error: j?.error || `HTTP ${r.status}` };
  }
  return { ok: true, note: 'фокус обновлён' };
}

async function tool_list_tasks(baseUrl, tgId, args) {
  const r = await fetch(`${baseUrl}/api/tasks?tg_id=${encodeURIComponent(tgId)}`, {
    headers: headersJson(tgId),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) {
    return { ok: false, error: j?.error || `HTTP ${r.status}` };
  }
  return { ok: true, items: (j.items || []).slice(0, 80) };
}

async function tool_delete_task(baseUrl, tgId, args) {
  const query = (args?.query || '').toString().toLowerCase().trim();
  const r = await fetch(`${baseUrl}/api/tasks?tg_id=${encodeURIComponent(tgId)}`, { headers: headersJson(tgId) });
  const j = await r.json().catch(() => ({}));
  const items = j.items || [];
  const candidates = items.filter(t => (t.title || '').toLowerCase().includes(query));
  if (!candidates.length) return { ok: false, error: 'not_found' };
  if (candidates.length > 1) {
    return { ok: false, error: 'ambiguous', sample: candidates.slice(0, 5).map(t => t.title) };
  }
  const t = candidates[0];
  const del = await fetch(`${baseUrl}/api/tasks/delete?id=${encodeURIComponent(t.id)}&tg_id=${encodeURIComponent(tgId)}`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({}),
  });
  if (!del.ok) return { ok: false, error: `HTTP ${del.status}` };
  return { ok: true, note: `задача "${t.title}" удалена` };
}

async function tool_complete_task(baseUrl, tgId, args) {
  const query = (args?.query || '').toString().toLowerCase().trim();
  const r = await fetch(`${baseUrl}/api/tasks?tg_id=${encodeURIComponent(tgId)}`, { headers: headersJson(tgId) });
  const j = await r.json().catch(() => ({}));
  const items = j.items || [];
  const candidates = items.filter(t => (t.title || '').toLowerCase().includes(query));
  if (!candidates.length) return { ok: false, error: 'not_found' };
  if (candidates.length > 1) {
    return { ok: false, error: 'ambiguous', sample: candidates.slice(0, 5).map(t => t.title) };
  }
  const t = candidates[0];
  const upd = await fetch(`${baseUrl}/api/tasks/toggle?id=${encodeURIComponent(t.id)}&tg_id=${encodeURIComponent(tgId)}`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({}),
  });
  if (!upd.ok) return { ok: false, error: `HTTP ${upd.status}` };
  return { ok: true, note: `задача "${t.title}" отмечена выполненной` };
}

/* ============ HTTP handler ============ */

export default async function handler(req, res) {
  await ensureSchema();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const tgId = getTgId(req) || (safeJson(req.body)?.tg_id ? String(safeJson(req.body).tg_id) : '');
  if (!tgId) {
    return res.status(400).json({ ok: false, error: 'tg_id required' });
  }

  const body = safeJson(req.body);
  const userText = (body?.text || '').toString().trim();
  if (!userText) {
    return res.status(400).json({ ok: false, error: 'Empty message' });
  }

  const baseUrl = getBaseUrl(req);

  // 1) DB: user + session + message
  let sessionId = null;
  try {
    const userId = await getOrCreateUserId(tgId);

    // session
    let sid = Number(body?.chat_id) || null;
    if (sid) {
      const s = await q(
        'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
        [sid, userId],
      );
      if (!s.rows.length) sid = null;
    }

    if (!sid) {
      const title = (body?.chat_title || 'Новый чат').toString().trim().slice(0, 80) || 'Новый чат';
      const ins = await q(
        `INSERT INTO chat_sessions (user_id, title)
         VALUES ($1, $2)
         RETURNING id`,
        [userId, title],
      );
      sid = ins.rows[0].id;
    }

    await q(
      `INSERT INTO chat_messages (chat_id, role, content)
       VALUES ($1, 'user', $2)`,
      [sid, userText],
    );

    // обновляем updated_at (НО НЕ ТРОГАЕМ title — он должен быть ровно как задал пользователь)
    await q(`UPDATE chat_sessions SET updated_at = now() WHERE id = $1`, [sid]);

    sessionId = sid;
  } catch (e) {
    console.error('[chat] db error:', e);
    // даже если БД легла — вернём ответ без падения клиента
    return res.status(200).json({
      ok: true,
      reply: 'Сейчас сервер БД недоступен. Попробуй ещё раз через минуту.',
      chat_id: null,
    });
  }

  // 2) Prepare prompt + history
  const ctx = await getContextSnapshot(baseUrl, tgId);

  const history = await q(
    `SELECT role, content
     FROM chat_messages
     WHERE chat_id = $1
     ORDER BY id ASC
     LIMIT 30`,
    [sessionId],
  ).then(r => r.rows || []).catch(() => []);

  const systemPrompt = buildSystemPrompt(ctx);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  ];

  const tools = [
    {
      type: 'function',
      function: {
        name: 'add_task',
        description: 'Создать новую задачу',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Короткий заголовок задачи (≤200 символов)' },
            due_ts: { type: ['integer', 'null'], description: 'Дедлайн в миллисекундах UNIX. null — без срока.' },
          },
          required: ['title'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'set_focus',
        description: 'Установить или обновить фокус дня',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string', description: 'Краткий фокус дня' } },
          required: ['text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_tasks',
        description: 'Получить задачи (для ответа пользователю)',
        parameters: {
          type: 'object',
          properties: { period: { type: 'string', description: 'today|tomorrow|week|backlog|overdue|all' } },
          required: ['period'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_task',
        description: 'Удалить задачу по части названия',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Фраза для поиска задачи' } },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'complete_task',
        description: 'Отметить задачу выполненной по части названия',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Фраза для поиска задачи' } },
          required: ['query'],
        },
      },
    },
  ];

  // 3) OpenAI (если сломается — всё равно отдадим нормальный ответ и сохраним chat_id)
  let replyText = '';
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    let steps = 0;

    while (steps < 3) {
      const resp = await openai.chat.completions.create({
        model,
        temperature: 0.35,
        messages,
        tools,
        tool_choice: 'auto',
      });

      const msg = resp.choices?.[0]?.message;
      if (!msg) break;

      const calls = msg.tool_calls || [];
      if (calls.length) {
        messages.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: calls,
        });

        for (const c of calls) {
          const name = c.function?.name;
          let args = {};
          try { args = JSON.parse(c.function?.arguments || '{}'); } catch {}

          let toolResult = {};
          try {
            if (name === 'add_task') toolResult = await tool_add_task(baseUrl, tgId, args);
            else if (name === 'set_focus') toolResult = await tool_set_focus(baseUrl, tgId, args);
            else if (name === 'list_tasks') toolResult = await tool_list_tasks(baseUrl, tgId, args);
            else if (name === 'delete_task') toolResult = await tool_delete_task(baseUrl, tgId, args);
            else if (name === 'complete_task') toolResult = await tool_complete_task(baseUrl, tgId, args);
            else toolResult = { ok: false, error: 'unknown_tool' };
          } catch (e) {
            toolResult = { ok: false, error: String(e?.message || e) };
          }

          messages.push({
            role: 'tool',
            tool_call_id: c.id,
            content: JSON.stringify(toolResult),
          });
        }

        steps += 1;
        continue;
      }

      replyText = (msg.content || '').trim() || 'Готово.';
      break;
    }
  } catch (e) {
    console.error('[chat] openai error:', e);
    replyText =
      'Похоже, ИИ сейчас временно недоступен. Напиши: ниша, продукт, цель на месяц и что уже пробовал — я соберу план.';
  }

  if (!replyText) {
    replyText = 'Окей. Скажи нишу/аудиторию/цель (выручка/лиды), и я соберу план на неделю.';
  }

  // 4) Save assistant message
  try {
    await q(
      `INSERT INTO chat_messages (chat_id, role, content)
       VALUES ($1, 'assistant', $2)`,
      [sessionId, replyText],
    );
    await q(`UPDATE chat_sessions SET updated_at = now() WHERE id = $1`, [sessionId]);
  } catch (e) {
    console.error('[chat] save assistant error:', e);
  }

  return res.status(200).json({
    ok: true,
    reply: replyText,
    chat_id: sessionId,
  });
}
