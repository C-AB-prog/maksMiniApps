// /api/[...slug].js
const { pool, ensureSchema, upsertUser } = require('./_db');
const { json, getUser, readBody } = require('./_utils');

const schemaReady = ensureSchema(); // поднимаем схему на холодном старте

module.exports = async (req, res) => {
  try {
    await schemaReady;

    const me = getUser(req, res);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname.replace(/^\/api\/?/, '');
    const parts = pathname.split('/').filter(Boolean);

    /* ---------------- HEALTH / DEBUG ---------------- */
    if (parts[0] === 'health') {
      try { await pool.query('select 1'); return json(res, { ok: true, db: 'ok' }); }
      catch (e) { return json(res, { ok: false, error: String(e.message || e) }, 500); }
    }
    if (parts[0] === 'debug') {
      const what = url.searchParams.get('what') || 'ping';
      if (what === 'ping') return json(res, { ok: true, pong: Date.now() });
      if (what === 'conn') {
        try { await pool.query('select 1'); return json(res, { ok: true }); }
        catch (e) { return json(res, { ok: false, error: String(e.message || e) }, 500); }
      }
      if (what === 'schema') {
        const r = await pool.query(`
          select table_name, column_name, data_type
          from information_schema.columns
          where table_schema='public'
          order by table_name, ordinal_position
        `);
        return json(res, { ok: true, columns: r.rows });
      }
      return json(res, { ok: true, note: 'ping|conn|schema' });
    }

    /* ---------------- FOCUS ---------------- */
    if (parts[0] === 'focus') {
      await upsertUser(me);

      if (req.method === 'GET') {
        const r = await pool.query(`select text, updated_at from focus where user_id=$1`, [me.id]);
        return json(res, r.rowCount ? r.rows[0] : {});
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const text = (body.text || '').toString().trim();
        if (!text) return json(res, { error: 'EMPTY' }, 400);
        await pool.query(
          `insert into focus(user_id, text, updated_at)
             values($1,$2, now())
           on conflict (user_id) do update
             set text=excluded.text, updated_at=now()`,
          [me.id, text]
        );
        return json(res, { ok: true });
      }
      return json(res, { error: 'Method Not Allowed' }, 405);
    }

    /* ---------------- TASKS ---------------- */
    if (parts[0] === 'tasks') {
      await upsertUser(me);

      if (req.method === 'GET') {
        const r = await pool.query(
          `select id, title, scope, done, due_at, created_at
             from tasks
            where user_id=$1
            order by done asc, coalesce(due_at, now() + interval '100 years') asc, id desc
            limit 300`,
          [me.id]
        );
        return json(res, { tasks: r.rows });
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        const title = String(body.title || '').trim();
        if (!title) return json(res, { error: 'EMPTY' }, 400);

        const scope = ['today','week','backlog'].includes(body.scope) ? body.scope : 'today';
        const due_at = body.due_at ? new Date(body.due_at) : null;

        await pool.query(
          `insert into tasks(user_id, title, scope, due_at)
           values($1,$2,$3,$4)`,
          [me.id, title, scope, due_at]
        );
        return json(res, { ok: true });
      }

      // PUT: id из /tasks/:id или ?id= или body.id
      if (req.method === 'PUT') {
        let id = parts[1] || url.searchParams.get('id');
        const body = await readBody(req);
        if (!id) id = body.id;
        id = Number(id);
        if (!id) return json(res, { error: 'missing id' }, 400);

        if ('done' in body) {
          await pool.query(`update tasks set done=$1 where id=$2 and user_id=$3`, [!!body.done, id, me.id]);
          return json(res, { ok: true });
        }
        if ('title' in body) {
          await pool.query(`update tasks set title=$1 where id=$2 and user_id=$3`, [String(body.title), id, me.id]);
          return json(res, { ok: true });
        }
        if ('scope' in body) {
          const scope = ['today','week','backlog'].includes(body.scope) ? body.scope : 'today';
          await pool.query(`update tasks set scope=$1 where id=$2 and user_id=$3`, [scope, id, me.id]);
          return json(res, { ok: true });
        }
        return json(res, { error: 'nothing to update' }, 400);
      }

      // DELETE: id из /tasks/:id или ?id= или body.id
      if (req.method === 'DELETE') {
        let id = parts[1] || url.searchParams.get('id');
        if (!id) { const b = await readBody(req); id = b.id; }
        id = Number(id);
        if (!id) return json(res, { error: 'missing id' }, 400);

        await pool.query(`delete from tasks where id=$1 and user_id=$2`, [id, me.id]);
        return json(res, { ok: true });
      }

      return json(res, { error: 'Method Not Allowed' }, 405);
    }

    /* ---------------- CHAT (умный) ---------------- */
    if (parts[0] === 'chat' && req.method === 'POST') {
      await upsertUser(me);
      const body = await readBody(req);
      const q = (body.q || '').toString().trim();
      if (!q) return json(res, { error: 'EMPTY' }, 400);

      // контекст
      const focus = await pool.query(`select text from focus where user_id=$1`, [me.id]);
      const tasks = await pool.query(
        `select id, title, scope, done, due_at
           from tasks
          where user_id=$1
          order by done asc, coalesce(due_at, now() + interval '100 years') asc, id desc
          limit 50`,
        [me.id]
      );

      // если нет OPENAI_API_KEY — лёгкий локальный разбор
      if (!process.env.OPENAI_API_KEY) {
        const reply = await ruleBasedReply(q, focus.rows[0]?.text || null, tasks.rows, me.id);
        return json(res, { a: reply });
      }

      // 1) зовём LLM за структурированным ответом
      const opsPayload = await llmPlanOps({
        q,
        focus: focus.rows[0]?.text || null,
        tasks: tasks.rows
      });

      // 2) применяем операции к БД
      const applied = await applyOps(me.id, opsPayload.ops || []);

      // 3) отдаём ответ пользователю
      const finalText = opsPayload.reply || applied.summary || 'Готово.';
      return json(res, { a: finalText });
    }

    /* ---------------- 404 ---------------- */
    return json(res, { error: 'not found', path: parts }, 404);
  } catch (e) {
    return json(res, { ok: false, error: String(e.message || e) }, 500);
  }
};

/* ---------------- helpers for CHAT ---------------- */

// Простой локальный разбор на русском, если нет OPENAI_API_KEY
async function ruleBasedReply(q, focusText, tasks, userId) {
  const low = q.toLowerCase();

  // добавить задачу
  if (low.startsWith('добавь') || low.includes('добавь задачу') || low.includes('создай задачу')) {
    const title = q.replace(/^(добавь( мне)?( пожалуйста)?( задачу)?|создай( мне)?( задачу)?)/i, '').trim() || 'Без названия';
    await pool.query(
      `insert into tasks(user_id, title, scope) values($1,$2,'today')`,
      [userId, title]
    );
    return `Добавил задачу: “${title}” в «Сегодня».`;
  }

  // поставить фокус
  if ((low.includes('фокус') || low.includes('фокус дня')) && (low.includes('постав') || low.includes('сделай') || low.includes('обнови'))) {
    const text = q.replace(/.*(фокус дня|фокус)\:?/i, '').trim() || q.trim();
    await pool.query(
      `insert into focus(user_id, text, updated_at)
       values($1,$2, now())
       on conflict (user_id) do update set text=excluded.text, updated_at=now()`,
      [userId, text]
    );
    return `Фокус дня обновлён: “${text}”.`;
  }

  // показать список
  if (low.includes('покажи') && (low.includes('задач') || low.includes('список'))) {
    if (!tasks.length) return 'Пока задач нет. Могу добавить — скажи “добавь задачу …”.';
    const lines = tasks.slice(0,8).map(t => `• ${t.done ? '✅' : '⬜️'} ${t.title}${t.due_at ? ` (дедлайн: ${new Date(t.due_at).toLocaleDateString()})` : ''}`);
    return `Ваши задачи:\n${lines.join('\n')}`;
  }

  // общее
  return focusText
    ? `Текущий фокус: “${focusText}”. Могу обновить фокус, добавить задачи или составить список на сегодня.`
    : `Готов помочь: добавлю задачи, поставлю фокус дня, соберу план. Скажи, что важно сейчас.`;
}

// Вызов LLM: просим вернуть строгий JSON-план
async function llmPlanOps(ctx) {
  const { OpenAI } = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const sys = `
Ты — ассистент продуктивности для мини-приложения. У тебя есть контекст пользователя (фокус и задачи).
Твоя задача: понять запрос и СФОРМИРОВАТЬ ОПЕРАЦИИ в строгом JSON, чтобы сервер их выполнил.

Всегда отвечай ТОЛЬКО JSON объектом со схемой:
{
  "reply": "короткий человеко-понятный ответ",
  "ops": [
    // ноль или больше операций
    { "type": "add_task", "title": "string", "scope": "today|week|backlog", "due_at": "ISO8601|null" },
    { "type": "set_focus", "text": "string" },
    { "type": "toggle_task", "id": 123, "title": "часть названия или полное", "done": true },
    { "type": "delete_task", "id": 123, "title": "часть названия или полное" }
  ]
}

Правила:
- Если пользователь просит «добавь/создай задачу», сделай add_task (scope по умолчанию today).
- Извлекай даты и приводи к ISO8601 (UTC) или оставляй null, если нет даты.
- Если просит «поставь/обнови фокус», делай set_focus.
- Если просит отметить/удалить конкретную задачу, укажи id если он известен из контекста; иначе добавь "title" для поиска по подстроке на сервере.
- Формируй понятный "reply" (1–3 коротких предложения). Не повторяй JSON в тексте.
- Не придумывай несущ. id. Если не знаешь id — оставь только "title".

Верни СТРОГО валидный JSON без комментариев и подсказок.
  `.trim();

  const user = `
Запрос пользователя: ${ctx.q}

Текущий фокус: ${ctx.focus ? ctx.focus : '(нет)'}
Задачи (${ctx.tasks.length}): ${ctx.tasks.map(t => `[${t.id}] ${t.done ? '✅' : '⬜️'} ${t.title}${t.due_at ? ' (due '+new Date(t.due_at).toISOString()+')' : ''}`).join('; ').slice(0, 4000)}
  `.trim();

  let content = '';
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      // попросим строго JSON
      response_format: { type: 'json_object' },
      temperature: 0.4,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ]
    });
    content = r.choices?.[0]?.message?.content || '{}';
  } catch (e) {
    // если модель не поддерживает response_format — повторим без него
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ]
    });
    content = r.choices?.[0]?.message?.content || '{}';
  }

  try { return JSON.parse(content); }
  catch { return { reply: 'Сформировал ответ, но не смог распарсить план. Давайте конкретнее?', ops: [] }; }
}

// Применяем операции к БД; допускаем поиск по части названия
async function applyOps(userId, ops) {
  const results = [];
  for (const op of ops) {
    try {
      switch (op.type) {
        case 'add_task': {
          const title = String(op.title || '').trim();
          if (!title) break;
          const scope = ['today','week','backlog'].includes(op.scope) ? op.scope : 'today';
          const due_at = op.due_at ? new Date(op.due_at) : null;
          await pool.query(
            `insert into tasks(user_id, title, scope, due_at) values($1,$2,$3,$4)`,
            [userId, title, scope, due_at]
          );
          results.push({ ok: true, type: op.type, title });
          break;
        }
        case 'set_focus': {
          const text = String(op.text || '').trim();
          if (!text) break;
          await pool.query(
            `insert into focus(user_id, text, updated_at)
             values($1,$2, now())
             on conflict (user_id) do update set text=excluded.text, updated_at=now()`,
            [userId, text]
          );
          results.push({ ok: true, type: op.type });
          break;
        }
        case 'toggle_task': {
          const id = await findTaskId(userId, op);
          if (!id) { results.push({ ok: false, type: op.type, reason: 'not_found' }); break; }
          await pool.query(`update tasks set done=$1 where id=$2 and user_id=$3`, [!!op.done, id, userId]);
          results.push({ ok: true, type: op.type, id });
          break;
        }
        case 'delete_task': {
          const id = await findTaskId(userId, op);
          if (!id) { results.push({ ok: false, type: op.type, reason: 'not_found' }); break; }
          await pool.query(`delete from tasks where id=$1 and user_id=$2`, [id, userId]);
          results.push({ ok: true, type: op.type, id });
          break;
        }
      }
    } catch (e) {
      results.push({ ok: false, type: op.type, error: String(e.message || e) });
    }
  }

  return {
    results,
    summary: results.length
      ? 'Готово: ' + results.map(r => r.ok ? r.type : `${r.type} (ошибка)`).join(', ')
      : ''
  };
}

async function findTaskId(userId, op) {
  if (op.id) return Number(op.id);
  const title = String(op.title || '').trim();
  if (!title) return null;
  // ищем по подстроке, приоритет невыполненных
  const r = await pool.query(
    `select id from tasks
      where user_id=$1 and title ilike '%'||$2||'%'
      order by done asc, created_at desc
      limit 1`,
    [userId, title]
  );
  return r.rows[0]?.id || null;
}
