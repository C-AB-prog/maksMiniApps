// api/chat.js
// LLM-чат с хранением в БД и инструментами (фокус, задачи, назначение по @username)

import { Pool } from 'pg';
import OpenAI from 'openai';

/* ============ DB ============ */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function ensureUser(client, tgId) {
  const idNum = Number(tgId);
  if (!idNum) throw new Error('tg_id required');

  const r = await client.query('SELECT id FROM users WHERE tg_id = $1', [idNum]);
  if (r.rows[0]) return r.rows[0].id;

  const ins = await client.query('INSERT INTO users (tg_id) VALUES ($1) RETURNING id', [idNum]);
  return ins.rows[0].id;
}

/* ============ helpers ============ */

function headersJson(tgId) {
  const h = { 'Content-Type': 'application/json' };
  if (tgId) h['X-TG-ID'] = String(tgId);
  return h;
}

function safeJson(body) {
  if (body && typeof body === 'object') return body;
  try {
    return JSON.parse(body || '{}');
  } catch {
    return {};
  }
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
  const ctx = {
    focus: null,
    tasks: [],
    teams: [],
    members: [],
    owned_team_ids: [],
  };

  // focus
  try {
    const f = await fetch(`${baseUrl}/api/focus`, { headers: headersJson(tgId) });
    if (f.ok) {
      const j = await f.json().catch(() => ({}));
      ctx.focus = j.focus || null;
    }
  } catch {}

  // tasks
  try {
    const t = await fetch(`${baseUrl}/api/tasks`, { headers: headersJson(tgId) });
    if (t.ok) {
      const j = await t.json().catch(() => ({}));
      ctx.tasks = (j.items || []).slice(0, 50);
    }
  } catch {}

  // team list (твой эндпоинт)
  try {
    const tl = await fetch(`${baseUrl}/api/team/list`, { headers: headersJson(tgId) });
    if (tl.ok) {
      const j = await tl.json().catch(() => ({}));
      ctx.teams = j.teams || [];
      ctx.owned_team_ids = (ctx.teams || [])
        .filter(t => !!t.is_owner)
        .map(t => Number(t.id))
        .filter(Boolean);
    }
  } catch {}

  // members for first team (если есть)
  const firstTeamId = ctx.teams?.[0]?.id ? Number(ctx.teams[0].id) : null;
  if (firstTeamId) {
    try {
      const m = await fetch(`${baseUrl}/api/team/members?team_id=${encodeURIComponent(firstTeamId)}`, {
        headers: headersJson(tgId),
      });
      if (m.ok) {
        const j = await m.json().catch(() => ({}));
        // у тебя items: [{username, ...}]
        ctx.members = (j.items || []).filter(x => x.username);
      }
    } catch {}
  }

  return ctx;
}

/**
 * Улучшенный промпт:
 * - умнее планирование
 * - меньше воды
 * - привязка к фокусу/задачам
 * - поддержка назначения задач по @username
 */
function buildSystemPrompt(ctx) {
  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);
  const year = now.getFullYear();

  const focusStr = ctx.focus?.text
    ? `ФОКУС СЕГОДНЯ: ${ctx.focus.text}`
    : `ФОКУС СЕГОДНЯ не задан.`;

  const members = (ctx.members || []).slice(0, 25).map(m => '@' + m.username).join(', ') || 'нет';

  const tasks = (ctx.tasks || []).slice(0, 12).map(t => {
    const ms = normalizeDue(t.due_ts);
    const due = ms ? `до ${fmtDate(ms)}` : 'без срока';
    const mark = t.is_done ? '✓' : '•';
    const team = t.team_id ? ' [команда]' : '';
    const assigned = t.assigned_to_user_id ? ' [назначено]' : '';
    return `${mark} ${t.title} (${due})${team}${assigned}`;
  }).join('\n');

  return [
    `Ты — Growth Assistant: умный, быстрый и практичный ассистент по задачам и дисциплине.`,
    `Сегодня: ${todayISO} (${year}). Всегда считай "сегодня/завтра/через неделю" относительно этой даты.`,
    ``,
    `Правила общения:`,
    `- Отвечай коротко и по делу. 1–3 предложения, затем при необходимости список 3–6 пунктов.`,
    `- Если пользователь расплывчат — задай ОДИН уточняющий вопрос (максимум один).`,
    `- Если можно помочь без уточнений — помогай сразу.`,
    `- Не выдумывай статусы задач: опирайся на контекст и результаты инструментов.`,
    ``,
    `Команды и участники:`,
    `- Участники (по @username): ${members}`,
    `- ВАЖНО: назначать задачи можно только по @username. Если username не указан — попроси пользователя написать @username.`,
    ``,
    `Инструменты:`,
    `- Если пользователь просит добавить/удалить/закрыть задачу или обновить фокус — вызывай соответствующую функцию.`,
    `- Если пользователь просит "покажи задачи" — вызывай list_tasks.`,
    `- Если пользователь просит "назначь задачу @username" — вызывай assign_task_by_username.`,
    `- Если пользователь просит создать командную задачу и назначить — вызывай create_team_task_assigned.`,
    ``,
    `Контекст пользователя:`,
    focusStr,
    tasks ? `ЗАДАЧИ (верхние):\n${tasks}` : 'ЗАДАЧ нет.',
  ].join('\n');
}

/* ============ HTTP handler ============ */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const body = safeJson(req.body);
    const { text, chat_id } = body;
    const userText = (text || '').toString().trim();
    if (!userText) {
      return res.status(400).json({ ok: false, error: 'Empty message' });
    }

    const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
    const baseUrl = `${proto}://${host}`;

    const tgIdHeader = (req.headers['x-tg-id'] || '').toString();
    const tgId = tgIdHeader || (body.tg_id || '').toString();
    if (!tgId) {
      return res.status(400).json({ ok: false, error: 'tg_id required' });
    }

    // ==== 1. Юзер и сессия чата в БД ====
    let sessionId;
    await withClient(async (client) => {
      const userId = await ensureUser(client, tgId);

      let sid = Number(chat_id) || null;
      if (sid) {
        const r = await client.query(
          'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
          [sid, userId]
        );
        if (!r.rows[0]) sid = null;
      }

      if (!sid) {
        const ins = await client.query(
          `INSERT INTO chat_sessions (user_id, title)
           VALUES ($1, $2)
           RETURNING id`,
          [userId, 'Новый чат']
        );
        sid = ins.rows[0].id;
      }

      await client.query(
        `INSERT INTO chat_messages (chat_id, role, content)
         VALUES ($1, 'user', $2)`,
        [sid, userText]
      );

      sessionId = sid;
    });

    // ==== 2. История и контекст ====
    const ctx = await getContextSnapshot(baseUrl, tgId);

    const history = await withClient(async (client) => {
      const r = await client.query(
        `SELECT role, content
         FROM chat_messages
         WHERE chat_id = $1
         ORDER BY id ASC
         LIMIT 30`,
        [sessionId]
      );
      return r.rows || [];
    });

    const systemPrompt = buildSystemPrompt(ctx);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      { role: 'user', content: userText },
    ];

    // ==== 3. Tools ====
    const tools = [
      {
        type: 'function',
        function: {
          name: 'add_task',
          description: 'Создать новую задачу (личную)',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Короткий заголовок задачи (≤120 символов)' },
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
          description: 'Получить задачи (с сервера)',
          parameters: {
            type: 'object',
            properties: {
              period: { type: 'string', description: 'today|tomorrow|week|backlog|overdue|all' },
            },
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
      {
        type: 'function',
        function: {
          name: 'assign_task_by_username',
          description: 'Назначить существующую командную задачу пользователю по @username (или снять назначение)',
          parameters: {
            type: 'object',
            properties: {
              task_query: { type: 'string', description: 'Часть названия задачи для поиска' },
              assignee_username: { type: ['string', 'null'], description: 'username без @. null — снять назначение' },
            },
            required: ['task_query', 'assignee_username'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'create_team_task_assigned',
          description: 'Создать командную задачу и назначить по @username (только если ты owner команды)',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Заголовок задачи' },
              due_ts: { type: ['integer', 'null'], description: 'Дедлайн в миллисекундах UNIX. null — без срока.' },
              assignee_username: { type: ['string', 'null'], description: 'username без @ или null' },
            },
            required: ['title'],
          },
        },
      },
    ];

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let steps = 0;
    let replyText = '';

    while (steps < 3) {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.25,
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
          try {
            args = JSON.parse(c.function?.arguments || '{}');
          } catch {}

          let toolResult = {};
          try {
            if (name === 'add_task') toolResult = await tool_add_task(baseUrl, tgId, args);
            else if (name === 'set_focus') toolResult = await tool_set_focus(baseUrl, tgId, args);
            else if (name === 'list_tasks') toolResult = await tool_list_tasks(baseUrl, tgId, args);
            else if (name === 'delete_task') toolResult = await tool_delete_task(baseUrl, tgId, args);
            else if (name === 'complete_task') toolResult = await tool_complete_task(baseUrl, tgId, args);
            else if (name === 'assign_task_by_username') toolResult = await tool_assign_task_by_username(baseUrl, tgId, args);
            else if (name === 'create_team_task_assigned') toolResult = await tool_create_team_task_assigned(baseUrl, tgId, args);
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

    if (!replyText) {
      replyText = 'Готово. Можешь попросить: “добавь задачу завтра в 15:00” или “назначь задачу X на @username”.';
    }

    // ==== 4. Сохраняем ответ ассистента ====
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO chat_messages (chat_id, role, content)
         VALUES ($1, 'assistant', $2)`,
        [sessionId, replyText]
      );
      await client.query(
        `UPDATE chat_sessions
         SET updated_at = now(), title = CASE
           WHEN title = 'Новый чат' THEN left($2, 80)
           ELSE title
         END
         WHERE id = $1`,
        [sessionId, replyText]
      );
    });

    return res.status(200).json({
      ok: true,
      reply: replyText,
      chat_id: sessionId,
    });
  } catch (e) {
    console.error('[chat] error:', e);
    return res.status(200).json({
      ok: true,
      reply:
        'Я на секунду задумался 😅 Напиши, что сделать: например, "добавь задачу завтра в 15:00" или "назначь задачу X на @username".',
      chat_id: null,
    });
  }
}

/* ===== tools ===== */

async function tool_add_task(baseUrl, tgId, args) {
  const title = (args?.title || '').toString().slice(0, 120);
  const due_ts = typeof args?.due_ts === 'number' ? args.due_ts : null;

  const r = await fetch(`${baseUrl}/api/tasks`, {
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
  const r = await fetch(`${baseUrl}/api/focus`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({ text }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) return { ok: false, error: j?.error || `HTTP ${r.status}` };
  return { ok: true, note: 'фокус обновлён' };
}

async function tool_list_tasks(baseUrl, tgId, args) {
  const r = await fetch(`${baseUrl}/api/tasks`, { headers: headersJson(tgId) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) return { ok: false, error: j?.error || `HTTP ${r.status}` };
  return { ok: true, items: (j.items || []).slice(0, 50) };
}

async function tool_delete_task(baseUrl, tgId, args) {
  const query = (args?.query || '').toString().toLowerCase().trim();
  const r = await fetch(`${baseUrl}/api/tasks`, { headers: headersJson(tgId) });
  const j = await r.json().catch(() => ({}));
  const items = j.items || [];
  const candidates = items.filter((t) => (t.title || '').toLowerCase().includes(query));

  if (!candidates.length) return { ok: false, error: 'not_found' };
  if (candidates.length > 1) return { ok: false, error: 'ambiguous', sample: candidates.slice(0, 5).map((t) => t.title) };

  const t = candidates[0];
  const del = await fetch(`${baseUrl}/api/tasks/delete?id=${encodeURIComponent(t.id)}`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({}),
  });
  if (!del.ok) return { ok: false, error: `HTTP ${del.status}` };
  return { ok: true, note: `задача "${t.title}" удалена` };
}

async function tool_complete_task(baseUrl, tgId, args) {
  const query = (args?.query || '').toString().toLowerCase().trim();
  const r = await fetch(`${baseUrl}/api/tasks`, { headers: headersJson(tgId) });
  const j = await r.json().catch(() => ({}));
  const items = j.items || [];
  const candidates = items.filter((t) => (t.title || '').toLowerCase().includes(query));

  if (!candidates.length) return { ok: false, error: 'not_found' };
  if (candidates.length > 1) return { ok: false, error: 'ambiguous', sample: candidates.slice(0, 5).map((t) => t.title) };

  const t = candidates[0];
  const upd = await fetch(`${baseUrl}/api/tasks/toggle?id=${encodeURIComponent(t.id)}`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({}),
  });
  if (!upd.ok) return { ok: false, error: `HTTP ${upd.status}` };
  return { ok: true, note: `задача "${t.title}" отмечена выполненной` };
}

async function tool_assign_task_by_username(baseUrl, tgId, args) {
  const task_query = (args?.task_query || '').toString().trim().toLowerCase();
  let uname = args?.assignee_username;
  uname = uname === null ? null : String(uname || '').trim().replace(/^@/, '').toLowerCase();

  if (!task_query) return { ok: false, error: 'task_query required' };

  // ищем задачу по названию
  const r = await fetch(`${baseUrl}/api/tasks`, { headers: headersJson(tgId) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) return { ok: false, error: j?.error || `HTTP ${r.status}` };

  const items = j.items || [];
  const hits = items.filter(t => (t.title || '').toLowerCase().includes(task_query) && !!t.team_id);

  if (!hits.length) return { ok: false, error: 'team task not found' };
  if (hits.length > 1) return { ok: false, error: 'ambiguous', sample: hits.slice(0, 5).map(t => t.title) };

  const task = hits[0];

  const a = await fetch(`${baseUrl}/api/tasks/assign`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({ task_id: task.id, assignee_username: uname }),
  });
  const aj = await a.json().catch(() => ({}));
  if (!a.ok || aj.ok === false) return { ok: false, error: aj?.error || `HTTP ${a.status}` };

  return { ok: true, note: uname ? `назначено @${uname}` : 'назначение снято', task: task.title };
}

async function tool_create_team_task_assigned(baseUrl, tgId, args) {
  const title = (args?.title || '').toString().slice(0, 120).trim();
  const due_ts = typeof args?.due_ts === 'number' ? args.due_ts : null;
  let uname = args?.assignee_username;
  uname = uname === null ? null : String(uname || '').trim().replace(/^@/, '').toLowerCase();

  if (!title) return { ok: false, error: 'title required' };

  // берём команду: prefer owned, else first
  const tl = await fetch(`${baseUrl}/api/team/list`, { headers: headersJson(tgId) });
  const tj = await tl.json().catch(() => ({}));
  if (!tl.ok || tj.ok === false) return { ok: false, error: tj?.error || `HTTP ${tl.status}` };

  const teams = tj.teams || [];
  if (!teams.length) return { ok: false, error: 'no teams' };

  const owned = teams.find(t => !!t.is_owner) || null;
  const team = owned || teams[0];
  const team_id = Number(team.id);
  if (!team_id) return { ok: false, error: 'bad team id' };

  // создаём командную задачу
  const cr = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: headersJson(tgId),
    body: JSON.stringify({ title, due_ts, team_id }),
  });
  const cj = await cr.json().catch(() => ({}));
  if (!cr.ok || cj.ok === false) return { ok: false, error: cj?.error || `HTTP ${cr.status}` };

  const taskId = cj.task?.id;
  if (uname && taskId) {
    const a = await fetch(`${baseUrl}/api/tasks/assign`, {
      method: 'POST',
      headers: headersJson(tgId),
      body: JSON.stringify({ task_id: taskId, assignee_username: uname }),
    });
    const aj = await a.json().catch(() => ({}));
    if (!a.ok || aj.ok === false) return { ok: false, error: aj?.error || `HTTP ${a.status}` };
    return { ok: true, note: `создано и назначено @${uname}` };
  }

  return { ok: true, note: 'командная задача создана' };
}
