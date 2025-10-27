// /api/[...slug].js
const { pool, ensureSchema, upsertUser } = require('./_db');
const { json, readBody, getUser } = require('./_utils');

const schemaReady = ensureSchema();

module.exports = async (req, res) => {
  try {
    await schemaReady;

    const me = getUser(req, res);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);

    /* ---- HEALTH / DEBUG ---- */
    if (parts[0] === 'health') {
      try { await pool.query('select 1'); return json(res, { ok: true, db: 'ok' }); }
      catch (e) { return json(res, { ok: false, error: String(e.message || e) }, 500); }
    }
    if (parts[0] === 'debug') {
      const what = url.searchParams.get('what') || 'ping';
      if (what === 'ping') return json(res, { ok: true, now: new Date().toISOString() });
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

    /* ---- FOCUS ---- */
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

    /* ---- TASKS ---- */
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
          `insert into tasks(user_id, title, scope, due_at) values($1,$2,$3,$4)`,
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

    /* ---- CHAT (умный) ---- */
    if (parts[0] === 'chat' && req.method === 'POST') {
      await upsertUser(me);
      const body = await readBody(req);
      const q = (body.q || '').toString().trim();
      const timezone = (req.headers['x-timezone'] || 'UTC').toString();

      if (!q) return json(res, { a: 'Задайте вопрос или команду.' });

      const focus = await pool.query(`select text from focus where user_id=$1`, [me.id]);
      const tasks = await pool.query(
        `select id, title, scope, done, due_at
           from tasks
          where user_id=$1
          order by done asc, coalesce(due_at, now() + interval '100 years') asc, id desc
          limit 50`,
        [me.id]
      );

      if (!process.env.OPENAI_API_KEY) {
        const reply = await ruleBasedReply(q, focus.rows[0]?.text || null, tasks.rows, me.id, timezone);
        return json(res, { a: reply });
      }

      const opsPayload = await llmPlanOps({
        q,
        focus: focus.rows[0]?.text || null,
        tasks: tasks.rows,
        timezone
      });

      if (!opsPayload.ops?.length && (!opsPayload.reply || opsPayload.reply.length > 300)) {
        const reply = await ruleBasedReply(q, focus.rows[0]?.text || null, tasks.rows, me.id, timezone);
        return json(res, { a: reply });
      }

      const applied = await applyOps(me.id, opsPayload.ops || []);
      const finalText = short(opsPayload.reply || applied.summary || 'Готово.');
      return json(res, { a: finalText });
    }

    /* ---- 404 ---- */
    return json(res, { error: 'not found', path: parts }, 404);
  } catch (e) {
    return json(res, { ok: false, error: String(e.message || e) }, 500);
  }
};

/* ===== Helpers for chat ===== */
function short(str) { return (str || '').toString().slice(0, 250); }

// Локальный разбор на русском (когда нет ключа или LLM ушёл в сторону)
async function ruleBasedReply(q, focusText, tasks, userId, timezone='UTC') {
  const low = q.toLowerCase();

  // "добавь задачу ... к/до/в 21:00" / "максимум в 21:00"
  const timeMatch = low.match(/(?:к|до|в|максимум\sв)\s*(\d{1,2})[:\.](\d{2})/);
  const addLike = /^(добавь|добавь задачу|создай|создай задачу)/i.test(low);
  const titleAfter = q.replace(/^добав(ь|и)\s(мне\s)?(пожалуйста\s)?(задачу\s)?/i, '').trim();

  if (addLike && titleAfter) {
    let dueAt = null;
    if (timeMatch) {
      const hh = Number(timeMatch[1]), mm = Number(timeMatch[2]);
      const now = new Date();
      now.setHours(hh, mm, 0, 0);
      dueAt = now.toISOString();
    }
    await pool.query(
      `insert into tasks(user_id, title, scope, due_at) values($1,$2,'today',$3)`,
      [userId, titleAfter, dueAt]
    );
    return `Добавил задачу «${titleAfter}»${dueAt ? ' до ' + new Date(dueAt).toLocaleTimeString().slice(0,5) : ''}.`;
  }

  // фокус
  if ((low.includes('фокус') || low.includes('фокус дня')) && /(постав|обнов|сделай)/.test(low)) {
    const text = q.replace(/.*(фокус дня|фокус)\:?/i, '').trim() || q.trim();
    await pool.query(
      `insert into focus(user_id, text, updated_at)
       values($1,$2, now())
       on conflict (user_id) do update set text=excluded.text, updated_at=now()`,
      [userId, text]
    );
    return `Фокус дня: «${text}».`;
  }

  // показать
  if (low.includes('покажи') && (low.includes('задач') || low.includes('список'))) {
    if (!tasks.length) return 'Пока задач нет. Скажи: «добавь задачу …».';
    const lines = tasks.slice(0,7).map(t => `${t.done ? '✅' : '⬜️'} ${t.title}`);
    return `Ваши задачи:\n` + lines.join('\n');
  }

  return focusText
    ? `Фокус: «${focusText}». Могу добавить задачи или собрать план.`
    : `Готов помочь: добавлю задачи, поставлю фокус, отмечу выполненные.`;
}

// LLM → строгий JSON-план
async function llmPlanOps(ctx) {
  const { OpenAI } = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const sys = `
Ты ассистент продуктивности. Отвечай ТОЛЬКО валидным JSON строго по схеме:
{
  "reply": "короткий ответ (1-2 предложения, без списков)",
  "ops": [
    { "type": "add_task", "title": "string", "scope": "today|week|backlog", "due_at": "ISO8601|null" },
    { "type": "set_focus", "text": "string" },
    { "type": "toggle_task", "id": 123, "title": "подстрока", "done": true },
    { "type": "delete_task", "id": 123, "title": "подстрока" }
  ]
}
Если просят «добавь/создай задачу … к/до/в HH:MM|21:00|9:30», заполни due_at в ISO8601 (сегодня, локальная зона).
Если просят «поставь фокус», делай set_focus.
Если не знаешь id задачи — оставь только "title" (поиск по подстроке на сервере).
Без Markdown, без пояснений — только JSON.
`.trim();

  const user = `
Запрос: ${ctx.q}
Текущий фокус: ${ctx.focus ? ctx.focus : '(нет)'}
Задачи (${ctx.tasks.length}): ${ctx.tasks.map(t => `[${t.id}] ${t.done ? '✅' : '⬜️'} ${t.title}`).join('; ').slice(0, 3000)}
Таймзона: ${ctx.timezone || 'UTC'}
Сегодня: ${new Date().toISOString()}
`.trim();

  let content = '{}';
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ]
    });
    content = r.choices?.[0]?.message?.content || '{}';
  } catch {
    const r2 = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: sys + '\nВерни строго JSON.' },
        { role: 'user', content: user }
      ]
    });
    content = r2.choices?.[0]?.message?.content || '{}';
  }

  try { return JSON.parse(content); }
  catch { return { reply: '', ops: [] }; }
}

async function applyOps(userId, ops=[]) {
  const out = { added:0, toggled:0, deleted:0, focus:false };
  for (const op of ops) {
    if (!op || !op.type) continue;

    if (op.type === 'add_task' && op.title) {
      await pool.query(
        `insert into tasks(user_id, title, scope, due_at) values($1,$2,$3,$4)`,
        [userId, short(op.title), op.scope || 'today', op.due_at || null]
      );
      out.added++;
    }

    if (op.type === 'set_focus' && op.text) {
      await pool.query(
        `insert into focus(user_id, text, updated_at)
         values($1,$2, now())
         on conflict (user_id) do update set text=excluded.text, updated_at=now()`,
        [userId, short(op.text)]
      );
      out.focus = true;
    }

    if (op.type === 'toggle_task') {
      let id = op.id;
      if (!id && op.title) {
        const r = await pool.query(
          `select id from tasks where user_id=$1 and title ilike $2 order by done asc, id desc limit 1`,
          [userId, `%${op.title}%`]
        );
        id = r.rows[0]?.id;
      }
      if (id) {
        await pool.query(`update tasks set done=$1 where user_id=$2 and id=$3`, [!!op.done, userId, id]);
        out.toggled++;
      }
    }

    if (op.type === 'delete_task') {
      let id = op.id;
      if (!id && op.title) {
        const r = await pool.query(
          `select id from tasks where user_id=$1 and title ilike $2 order by id desc limit 1`,
          [userId, `%${op.title}%`]
        );
        id = r.rows[0]?.id;
      }
      if (id) {
        await pool.query(`delete from tasks where user_id=$1 and id=$2`, [userId, id]);
        out.deleted++;
      }
    }
  }

  let summary = '';
  if (out.added) summary += `Добавил ${out.added} задач(и). `;
  if (out.toggled) summary += `Обновил статус ${out.toggled}. `;
  if (out.deleted) summary += `Удалил ${out.deleted}. `;
  if (out.focus) summary += `Фокус обновлён.`;
  return { summary: summary.trim() };
}
