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
  if (v === null || v === undefined || v === '') return null;
  const num = Number(v);
  if (!Number.isNaN(num)) {
    const ms = num < 1e12 ? num * 1000 : num; // sec -> ms
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

/**
 * Вместо fetch к самому себе (что замедляет и иногда ломается в serverless),
 * берём быстрый снэпшот прямо из БД.
 */
async function getContextSnapshotFast(userId) {
  const ctx = { focus: null, tasks: [] };

  try {
    const f = await q(
      `SELECT id, text
       FROM focuses
       WHERE user_id = $1
       ORDER BY id DESC
       LIMIT 1`,
      [userId],
    );
    ctx.focus = f.rows[0] || null;
  } catch {}

  try {
    const t = await q(
      `SELECT id, title, due_ts, is_done, team_id, assigned_to_user_id
       FROM tasks
       WHERE user_id = $1 AND team_id IS NULL
       ORDER BY COALESCE(due_ts, 9223372036854775807), id DESC
       LIMIT 20`,
      [userId],
    );

    ctx.tasks = (t.rows || []).map(x => ({
      ...x,
      id: Number(x.id),
      due_ts: x.due_ts == null ? null : Number(x.due_ts),
      team_id: x.team_id == null ? null : Number(x.team_id),
      assigned_to_user_id: x.assigned_to_user_id == null ? null : Number(x.assigned_to_user_id),
    }));
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

  const tasks = (ctx.tasks || []).slice(0, 12).map(t => {
    const ms = normalizeDue(t.due_ts);
    const due = ms ? `до ${fmtDate(ms)}` : 'без срока';
    const mark = t.is_done ? '✓' : '•';
    return `${mark} ${t.title} (${due})`;
  }).join('\n');

  return [
    `Ты — Growth Assistant: сильный практичный ассистент предпринимателя.`,
    `Помогай расти: продукт, продажи, маркетинг, финансы, найм, процессы.`,
    ``,
    `Сегодня: ${todayISO}. Любые "сегодня/завтра/через неделю" считай относительно этой даты.`,
    ``,
    `Стиль ответа:`,
    `- По делу. Сначала 2–4 предложения сути, затем план (3–8 пунктов).`,
    `- Если данных не хватает — задай ОДИН уточняющий вопрос.`,
    ``,
    `Инструменты (tasks/focus):`,
    `- Используй инструменты ТОЛЬКО когда пользователь явно просит: добавить/удалить/закрыть задачу, показать задачи, поставить фокус.`,
    ``,
    `Контекст пользователя:`,
    focusStr,
    tasks ? `ЗАДАЧИ (верхние):\n${tasks}` : 'ЗАДАЧ нет.',
  ].join('\n');
}

/* ====== инструменты через /api/tasks и /api/focus (оставляем как было) ===== */

async function tool_add_task(baseUrl, tgId, args) {
  const title = (args?.title || '').toString().slice(0, 200);
  const due_ts = normalizeDue(args?.due_ts);

  const r = await fetch(`${baseUrl}/api/tasks?tg_id=${encodeURIComponent(tgId)}`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({ title, due_ts }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) return { ok: false, error: j?.error || `HTTP ${r.status}` };

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
  if (!r.ok || j.ok === false) return { ok: false, error: j?.error || `HTTP ${r.status}` };
  return { ok: true, note: 'фокус обновлён' };
}

async function tool_list_tasks(baseUrl, tgId) {
  const r = await fetch(`${baseUrl}/api/tasks?tg_id=${encodeURIComponent(tgId)}`, {
    headers: headersJson(tgId),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) return { ok: false, error: j?.error || `HTTP ${r.status}` };
  return { ok: true, items: (j.items || []).slice(0, 80) };
}

async function tool_delete_task(baseUrl, tgId, args) {
  const query = (args?.query || '').toString().toLowerCase().trim();
  const r = await fetch(`${baseUrl}/api/tasks?tg_id=${encodeURIComponent(tgId)}`, { headers: headersJson(tgId) });
  const j = await r.json().catch(() => ({}));
  const items = j.items || [];
  const candidates = items.filter(t => (t.title || '').toLowerCase().includes(query));
  if (!candidates.length) return { ok: false, error: 'not_found' };
  if (candidates.length > 1) return { ok: false, error: 'ambiguous', sample: candidates.slice(0, 5).map(t => t.title) };

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
  if (candidates.length > 1) return { ok: false, error: 'ambiguous', sample: candidates.slice(0, 5).map(t => t.title) };

  const t = candidates[0];
  const upd = await fetch(`${baseUrl}/api/tasks/toggle?id=${encodeURIComponent(t.id)}&tg_id=${encodeURIComponent(tgId)}`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({}),
  });
  if (!upd.ok) return { ok: false, error: `HTTP ${upd.status}` };
  return { ok: true, note: `задача "${t.title}" отмечена выполненной` };
}

/* ============ OpenAI with model fallback ============ */

function uniq(arr) {
  const out = [];
  const s = new Set();
  for (const x of arr) {
    const v = (x || '').toString().trim();
    if (!v) continue;
    if (s.has(v)) continue;
    s.add(v);
    out.push(v);
  }
  return out;
}

function isModelError(e) {
  const status = Number(e?.status || e?.response?.status || 0);
  const msg = String(e?.message || '').toLowerCase();
  // 400/404/403 часто бывают при неправильной модели или отсутствии доступа
  return status === 400 || status === 403 || status === 404 || msg.includes('model');
}

async function createChatCompletionWithFallback(openai, params) {
  const candidates = uniq([
    process.env.OPENAI_MODEL,
    'gpt-4o-mini',
    'gpt-4.1-mini',
  ]);

  let lastErr = null;
  for (const model of candidates) {
    try {
      return await openai.chat.completions.create({ ...params, model });
    } catch (e) {
      lastErr = e;
      if (!isModelError(e)) break;
      // пробуем следующую модель
    }
  }
  throw lastErr;
}

/* ============ HTTP handler ============ */

export default async function handler(req, res) {
  await ensureSchema();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const tgId = getTgId(req) || (safeJson(req.body)?.tg_id ? String(safeJson(req.body).tg_id) : '');
  if (!tgId) return res.status(400).json({ ok: false, error: 'tg_id required' });

  const body = safeJson(req.body);
  const userText = (body?.text || '').toString().trim();
  if (!userText) return res.status(400).json({ ok: false, error: 'Empty message' });

  const baseUrl = getBaseUrl(req);

  // 1) DB: user + session + message
  let sessionId = null;
  let userId = null;
  try {
    userId = await getOrCreateUserId(tgId);

    // session
    let sid = Number(body?.chat_id) || null;
    if (sid) {
      const s = await q('SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2', [sid, userId]);
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

    await q(`UPDATE chat_sessions SET updated_at = now() WHERE id = $1`, [sid]);

    sessionId = sid;
  } catch (e) {
    console.error('[chat] db error:', e);
    return res.status(200).json({
      ok: true,
      reply: 'Сейчас сервер БД недоступен. Попробуй ещё раз через минуту.',
      chat_id: null,
    });
  }

  // 2) Prepare prompt + history (короче для скорости)
  const ctx = await getContextSnapshotFast(userId);

  const history = await q(
    `SELECT role, content
     FROM chat_messages
     WHERE chat_id = $1
     ORDER BY id ASC
     LIMIT 20`,
    [sessionId],
  ).then(r => r.rows || []).catch(() => []);

  const systemPrompt = buildSystemPrompt(ctx);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content })),
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
            due_ts: { type: ['integer', 'string', 'null'], description: 'Дедлайн (ms UNIX или дата/строка). null — без срока.' },
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
        parameters: { type: 'object', properties: {} },
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

  // 3) OpenAI (fallback model)
  let replyText = '';
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 60_000,
    });

    // один проход + максимум один раунд tool-calls (чтобы не висеть)
    const resp1 = await createChatCompletionWithFallback(openai, {
      temperature: 0.35,
      max_tokens: 700,
      messages,
      tools,
      tool_choice: 'auto',
    });

    const msg1 = resp1.choices?.[0]?.message;
    const calls = msg1?.tool_calls || [];

    if (calls.length) {
      messages.push({ role: 'assistant', content: msg1.content || '', tool_calls: calls });

      for (const c of calls) {
        const name = c.function?.name;
        let args = {};
        try { args = JSON.parse(c.function?.arguments || '{}'); } catch {}

        let toolResult = {};
        try {
          if (name === 'add_task') toolResult = await tool_add_task(baseUrl, tgId, args);
          else if (name === 'set_focus') toolResult = await tool_set_focus(baseUrl, tgId, args);
          else if (name === 'list_tasks') toolResult = await tool_list_tasks(baseUrl, tgId);
          else if (name === 'delete_task') toolResult = await tool_delete_task(baseUrl, tgId, args);
          else if (name === 'complete_task') toolResult = await tool_complete_task(baseUrl, tgId, args);
          else toolResult = { ok: false, error: 'unknown_tool' };
        } catch (e) {
          toolResult = { ok: false, error: String(e?.message || e) };
        }

        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(toolResult) });
      }

      const resp2 = await createChatCompletionWithFallback(openai, {
        temperature: 0.35,
        max_tokens: 700,
        messages,
      });

      replyText = (resp2.choices?.[0]?.message?.content || '').trim();
    } else {
      replyText = (msg1?.content || '').trim();
    }
  } catch (e) {
    console.error('[chat] openai error:', e);
    // IMPORTANT: показываем причину (коротко), чтобы ты сразу понял где затык
    const status = e?.status || e?.response?.status;
    const msg = String(e?.message || 'openai_error').slice(0, 160);
    replyText = `ИИ не отвечает. Проверь OPENAI_API_KEY и OPENAI_MODEL в Vercel. Ошибка${status ? ' '+status : ''}: ${msg}`;
  }

  if (!replyText) replyText = 'Окей. Скажи нишу/аудиторию/цель, и я соберу план на неделю.';

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

  return res.status(200).json({ ok: true, reply: replyText, chat_id: sessionId });
}
