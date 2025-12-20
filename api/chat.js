// api/chat.js
// LLM-чат с хранением в БД и инструментами (фокус, задачи)

import OpenAI from "openai";
import { q, ensureSchema } from "./_db.js";
import { getTgId, getOrCreateUserId, getBaseUrl } from "./_utils.js";

/* ===== helpers ===== */

function safeBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
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
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function headersJson(tgId) {
  const h = { "Content-Type": "application/json" };
  if (tgId) h["X-TG-ID"] = String(tgId);
  return h;
}

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
      ctx.tasks = (j.items || []).slice(0, 30);
    }
  } catch {}

  return ctx;
}

function buildSystemPrompt(ctx) {
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const year = today.getFullYear();

  const focusStr = ctx.focus?.text
    ? `ТЕКУЩИЙ ФОКУС: ${ctx.focus.text}`
    : "ТЕКУЩИЙ ФОКУС не задан.";

  const topTasks = (ctx.tasks || [])
    .slice(0, 10)
    .map((t) => {
      const ms = normalizeDue(t.due_ts);
      const due = ms ? `до ${fmtDate(ms)}` : "без срока";
      const mark = t.is_done ? "✓" : "•";
      return `${mark} ${t.title} (${due})`;
    })
    .join("\n");

  return [
    `Ты — деловой ассистент по продуктивности Growth Assistant.`,
    `Текущая календарная дата: ${todayISO}, сейчас ${year} год. Никогда не говори, что сейчас 2023 или другой год.`,
    `Если пользователь говорит "сегодня", "завтра", "через неделю" — считай относительно даты ${todayISO}.`,
    ``,
    `Ты умеешь использовать инструменты, чтобы:`,
    `- добавлять задачи с дедлайнами,`,
    `- отмечать задачи выполненными,`,
    `- удалять задачи,`,
    `- показывать задачи,`,
    `- обновлять фокус дня.`,
    `Если пользователь явно просит изменить задачи или фокус — вызывай инструмент.`,
    ``,
    `Формат ответа: 1–3 коротких предложения по делу. Без воды.`,
    `Если уместно — добавь маркированный список из 3–5 шагов.`,
    ``,
    `Контекст пользователя:`,
    focusStr,
    topTasks ? `ЗАДАЧИ:\n${topTasks}` : "ЗАДАЧ нет.",
  ].join("\n");
}

/* ===== инструменты через /api/tasks и /api/focus ===== */

async function tool_add_task(baseUrl, tgId, args) {
  const title = (args?.title || "").toString().slice(0, 120);
  const due_ts = typeof args?.due_ts === "number" ? args.due_ts : null;

  const r = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: headersJson(tgId),
    body: JSON.stringify({ title, due_ts }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) return { ok: false, error: j?.error || `HTTP ${r.status}` };

  const when = due_ts ? fmtDate(due_ts) : "без срока";
  return { ok: true, note: `задача создана (до ${when})` };
}

async function tool_set_focus(baseUrl, tgId, args) {
  const text = (args?.text || "").toString().slice(0, 200);
  const r = await fetch(`${baseUrl}/api/focus`, {
    method: "POST",
    headers: headersJson(tgId),
    body: JSON.stringify({ text }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) return { ok: false, error: j?.error || `HTTP ${r.status}` };
  return { ok: true, note: "фокус обновлён" };
}

async function tool_list_tasks(baseUrl, tgId, args) {
  // пока просто отдаём список (у тебя уже есть фильтры на фронте)
  const r = await fetch(`${baseUrl}/api/tasks`, { headers: headersJson(tgId) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) return { ok: false, error: j?.error || `HTTP ${r.status}` };
  return { ok: true, items: (j.items || []).slice(0, 50), period: args?.period || "all" };
}

async function tool_delete_task(baseUrl, tgId, args) {
  const query = (args?.query || "").toString().toLowerCase().trim();
  if (!query) return { ok: false, error: "query_required" };

  const r = await fetch(`${baseUrl}/api/tasks`, { headers: headersJson(tgId) });
  const j = await r.json().catch(() => ({}));
  const items = j.items || [];

  const candidates = items.filter((t) => (t.title || "").toLowerCase().includes(query));
  if (!candidates.length) return { ok: false, error: "not_found" };
  if (candidates.length > 1) {
    return { ok: false, error: "ambiguous", sample: candidates.slice(0, 5).map((t) => t.title) };
  }

  const t = candidates[0];
  const del = await fetch(`${baseUrl}/api/tasks/delete?id=${encodeURIComponent(t.id)}`, {
    method: "POST",
    headers: headersJson(tgId),
    body: JSON.stringify({}),
  });
  if (!del.ok) return { ok: false, error: `HTTP ${del.status}` };

  return { ok: true, note: `задача "${t.title}" удалена` };
}

async function tool_complete_task(baseUrl, tgId, args) {
  const query = (args?.query || "").toString().toLowerCase().trim();
  if (!query) return { ok: false, error: "query_required" };

  const r = await fetch(`${baseUrl}/api/tasks`, { headers: headersJson(tgId) });
  const j = await r.json().catch(() => ({}));
  const items = j.items || [];

  const candidates = items.filter((t) => (t.title || "").toLowerCase().includes(query));
  if (!candidates.length) return { ok: false, error: "not_found" };
  if (candidates.length > 1) {
    return { ok: false, error: "ambiguous", sample: candidates.slice(0, 5).map((t) => t.title) };
  }

  const t = candidates[0];
  const upd = await fetch(`${baseUrl}/api/tasks/toggle?id=${encodeURIComponent(t.id)}`, {
    method: "POST",
    headers: headersJson(tgId),
    body: JSON.stringify({}),
  });
  if (!upd.ok) return { ok: false, error: `HTTP ${upd.status}` };

  return { ok: true, note: `задача "${t.title}" отмечена выполненной` };
}

/* ===== handler ===== */

export default async function handler(req, res) {
  await ensureSchema();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const body = safeBody(req);

    const tgId = getTgId(req) || Number(body.tg_id || 0);
    if (!tgId) return res.status(400).json({ ok: false, error: "tg_id required" });

    const userText = (body.text || "").toString().trim();
    if (!userText) return res.status(400).json({ ok: false, error: "Empty message" });

    const userId = await getOrCreateUserId(tgId);

    // chat_id либо новый
    let sessionId = Number(body.chat_id || 0) || null;

    if (sessionId) {
      const s = await q("SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2", [
        sessionId,
        userId,
      ]);
      if (!s.rows.length) sessionId = null;
    }

    if (!sessionId) {
      const chatTitle = (body.chat_title || "Новый чат").toString().trim().slice(0, 80) || "Новый чат";
      const ins = await q(
        `INSERT INTO chat_sessions (user_id, title)
         VALUES ($1, $2)
         RETURNING id`,
        [userId, chatTitle],
      );
      sessionId = ins.rows[0].id;
    }

    // сохраняем user message
    await q(
      `INSERT INTO chat_messages (chat_id, role, content)
       VALUES ($1, 'user', $2)`,
      [sessionId, userText],
    );

    // история (после вставки — включает сообщение)
    const historyR = await q(
      `SELECT role, content
       FROM chat_messages
       WHERE chat_id = $1
       ORDER BY id ASC
       LIMIT 30`,
      [sessionId],
    );
    const history = historyR.rows || [];

    const baseUrl = getBaseUrl(req);
    const ctx = await getContextSnapshot(baseUrl, tgId);

    const systemPrompt = buildSystemPrompt(ctx);

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    ];

    const tools = [
      {
        type: "function",
        function: {
          name: "add_task",
          description: "Создать новую задачу",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Короткий заголовок задачи (≤120 символов)" },
              due_ts: { type: ["integer", "null"], description: "Дедлайн в миллисекундах UNIX. null — без срока." },
            },
            required: ["title"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "set_focus",
          description: "Установить или обновить фокус дня",
          parameters: {
            type: "object",
            properties: { text: { type: "string", description: "Краткий фокус дня" } },
            required: ["text"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "list_tasks",
          description: "Получить задачи в заданном периоде",
          parameters: {
            type: "object",
            properties: {
              period: { type: "string", description: "today|tomorrow|week|backlog|overdue|all" },
            },
            required: ["period"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "delete_task",
          description: "Удалить задачу по части названия",
          parameters: {
            type: "object",
            properties: { query: { type: "string", description: "Фраза для поиска задачи" } },
            required: ["query"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "complete_task",
          description: "Отметить задачу выполненной по части названия",
          parameters: {
            type: "object",
            properties: { query: { type: "string", description: "Фраза для поиска задачи" } },
            required: ["query"],
          },
        },
      },
    ];

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    let steps = 0;
    let replyText = "";

    while (steps < 3) {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages,
        tools,
        tool_choice: "auto",
      });

      const msg = resp.choices?.[0]?.message;
      if (!msg) break;

      const calls = msg.tool_calls || [];
      if (calls.length) {
        messages.push({ role: "assistant", content: msg.content || "", tool_calls: calls });

        for (const c of calls) {
          const name = c.function?.name;
          let args = {};
          try {
            args = JSON.parse(c.function?.arguments || "{}");
          } catch {}

          let toolResult = {};
          try {
            if (name === "add_task") toolResult = await tool_add_task(baseUrl, tgId, args);
            else if (name === "set_focus") toolResult = await tool_set_focus(baseUrl, tgId, args);
            else if (name === "list_tasks") toolResult = await tool_list_tasks(baseUrl, tgId, args);
            else if (name === "delete_task") toolResult = await tool_delete_task(baseUrl, tgId, args);
            else if (name === "complete_task") toolResult = await tool_complete_task(baseUrl, tgId, args);
            else toolResult = { ok: false, error: "unknown_tool" };
          } catch (e) {
            toolResult = { ok: false, error: String(e?.message || e) };
          }

          messages.push({
            role: "tool",
            tool_call_id: c.id,
            content: JSON.stringify(toolResult),
          });
        }

        steps += 1;
        continue;
      }

      replyText = (msg.content || "").trim() || "Готово.";
      break;
    }

    if (!replyText) replyText = "Готово.";

    // сохраняем assistant
    await q(
      `INSERT INTO chat_messages (chat_id, role, content)
       VALUES ($1, 'assistant', $2)`,
      [sessionId, replyText],
    );

    await q(
      `UPDATE chat_sessions
       SET updated_at = now(),
           title = CASE
             WHEN title = 'Новый чат' THEN left($2, 80)
             ELSE title
           END
       WHERE id = $1`,
      [sessionId, replyText],
    );

    return res.status(200).json({ ok: true, reply: replyText, chat_id: sessionId });
  } catch (e) {
    console.error("[chat] error:", e);
    return res.status(200).json({
      ok: true,
      reply:
        "Я на секунду задумался 😅 Напиши, что сделать: например, «добавь задачу завтра в 15:00» или «фокус: подготовка к встрече».",
      chat_id: null,
    });
  }
}
