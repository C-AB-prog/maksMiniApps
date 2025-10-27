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

    /* ------------ HEALTH / DEBUG ------------ */
    if (parts[0] === 'health') {
      try { await pool.query('select 1'); return json(res, { ok:true, db:'ok' }); }
      catch (e) { return json(res, { ok:false, where:'health', error:String(e.message||e) }, 500); }
    }
    if (parts[0] === 'debug') {
      const what = url.searchParams.get('what') || 'ping';
      if (what === 'ping') return json(res, { ok:true, now:new Date().toISOString() });
      if (what === 'whoami') return json(res, { ok:true, id:me.id, tg_id:me.tg_id||null });
      if (what === 'conn') {
        try { await pool.query('select 1'); return json(res, { ok:true }); }
        catch (e){ return json(res, { ok:false, where:'conn', error:String(e.message||e) }, 500); }
      }
      if (what === 'schema') {
        const r = await pool.query(`
          select table_name, column_name, data_type
          from information_schema.columns
          where table_schema='public'
          order by table_name, ordinal_position
        `);
        return json(res, { ok:true, columns:r.rows });
      }
      if (what === 'rwtest') {
        try {
          await upsertUser(me);
          await pool.query(`insert into tasks(user_id, title, scope) values($1,$2,'today')`, [me.id, 'TEST']);
          await pool.query(
            `insert into focus(user_id, text, updated_at)
             values($1,$2, now())
             on conflict (user_id) do update set text=excluded.text, updated_at=now()`,
            [me.id, 'Фокус из rwtest']
          );
          return json(res, { ok:true, note:'created test records' });
        } catch (e) {
          return json(res, { ok:false, where:'rwtest', error:String(e.message||e) }, 500);
        }
      }
      return json(res, { ok:true, note:'ping|whoami|conn|schema|rwtest' });
    }

    /* ------------ FOCUS ------------ */
    if (parts[0] === 'focus') {
      try {
        await upsertUser(me);

        if (req.method === 'GET') {
          const r = await pool.query(`select text, updated_at from focus where user_id=$1`, [me.id]);
          return json(res, r.rowCount ? r.rows[0] : {});
        }
        if (req.method === 'PUT') {
          const body = await readBody(req);
          const text = (body.text || '').toString().trim();
          if (!text) return json(res, { error:'EMPTY_TEXT' }, 400);
          await pool.query(
            `insert into focus(user_id, text, updated_at)
             values($1,$2, now())
             on conflict (user_id) do update
               set text=excluded.text, updated_at=now()`,
            [me.id, text]
          );
          return json(res, { ok:true });
        }
        return json(res, { error:'METHOD_NOT_ALLOWED' }, 405);
      } catch (e) {
        return json(res, { ok:false, where:'focus', error:String(e.message||e) }, 500);
      }
    }

    /* ------------ TASKS ------------ */
    if (parts[0] === 'tasks') {
      try {
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
          return json(res, { tasks:r.rows });
        }

        if (req.method === 'POST') {
          const body = await readBody(req);
          const title = String(body.title || '').trim();
          if (!title) return json(res, { error:'EMPTY_TITLE' }, 400);
          const scope = ['today','week','backlog'].includes(body.scope) ? body.scope : 'today';
          const due_at = body.due_at ? new Date(body.due_at) : null;
          await pool.query(
            `insert into tasks(user_id, title, scope, due_at) values($1,$2,$3,$4)`,
            [me.id, title, scope, due_at]
          );
          return json(res, { ok:true });
        }

        if (req.method === 'PUT') {
          let id = parts[1] || url.searchParams.get('id');
          const body = await readBody(req);
          if (!id) id = body.id;
          id = Number(id);
          if (!id) return json(res, { error:'MISSING_ID' }, 400);

          if ('done' in body) {
            await pool.query(`update tasks set done=$1 where id=$2 and user_id=$3`, [!!body.done, id, me.id]);
            return json(res, { ok:true });
          }
          if ('title' in body) {
            await pool.query(`update tasks set title=$1 where id=$2 and user_id=$3`, [String(body.title), id, me.id]);
            return json(res, { ok:true });
          }
          if ('scope' in body) {
            const scope = ['today','week','backlog'].includes(body.scope) ? body.scope : 'today';
            await pool.query(`update tasks set scope=$1 where id=$2 and user_id=$3`, [scope, id, me.id]);
            return json(res, { ok:true });
          }
          return json(res, { error:'NOTHING_TO_UPDATE' }, 400);
        }

        if (req.method === 'DELETE') {
          let id = parts[1] || url.searchParams.get('id');
          if (!id) { const b = await readBody(req); id = b.id; }
          id = Number(id);
          if (!id) return json(res, { error:'MISSING_ID' }, 400);
          await pool.query(`delete from tasks where id=$1 and user_id=$2`, [id, me.id]);
          return json(res, { ok:true });
        }

        return json(res, { error:'METHOD_NOT_ALLOWED' }, 405);
      } catch (e) {
        return json(res, { ok:false, where:'tasks', error:String(e.message||e) }, 500);
      }
    }

    /* ------------ CHAT (короткий ответ + LLM при наличии ключа) ------------ */
    if (parts[0] === 'chat' && req.method === 'POST') {
      try {
        await upsertUser(me);
        const body = await readBody(req);
        const q = (body.q || '').toString().trim();
        const timezone = (req.headers['x-timezone'] || 'UTC').toString();

        if (!q) return json(res, { a:'Скажи, что сделать: добавить задачу, поставить фокус, показать список.' });

        const focus = await pool.query(`select text from focus where user_id=$1`, [me.id]);
        const tasks = await pool.query(
          `select id, title, scope, done, due_at
           from tasks where user_id=$1
           order by done asc, coalesce(due_at, now()+interval '100 years') asc, id desc limit 50`,
          [me.id]
        );

        // fallback правила (без OpenAI)
        async function ruleBased() {
          const low = q.toLowerCase();

          const timeMatch = low.match(/(?:к|до|в|максимум\sв)\s*(\d{1,2})[:\.](\d{2})/);
          const addLike = /^(добавь|добавь задачу|создай|создай задачу)/i.test(low);
          const titleAfter = q.replace(/^добав(ь|и)\s(мне\s)?(пожалуйста\s)?(задачу\s)?/i, '').trim();

          if (addLike && titleAfter) {
            let dueAt = null;
            if (timeMatch) {
              const hh = Number(timeMatch[1]), mm = Number(timeMatch[2]);
              const now = new Date(); now.setHours(hh, mm, 0, 0);
              dueAt = now.toISOString();
            }
            await pool.query(`insert into tasks(user_id, title, scope, due_at) values($1,$2,'today',$3)`, [me.id, titleAfter, dueAt]);
            return `Добавил задачу «${titleAfter}»${dueAt ? ' до ' + new Date(dueAt).toLocaleTimeString().slice(0,5) : ''}.`;
          }

          if ((low.includes('фокус') || low.includes('фокус дня')) && /(постав|обнов|сделай)/.test(low)) {
            const text = q.replace(/.*(фокус дня|фокус)\:?/i, '').trim() || q.trim();
            await pool.query(
              `insert into focus(user_id, text, updated_at)
               values($1,$2, now())
               on conflict (user_id) do update set text=excluded.text, updated_at=now()`,
              [me.id, text]
            );
            return `Фокус дня: «${text}».`;
          }

          if (low.includes('покажи') && (low.includes('задач') || low.includes('список'))) {
            if (!tasks.rows.length) return 'Пока задач нет. Скажи: «добавь задачу …».';
            const lines = tasks.rows.slice(0,7).map(t => `${t.done ? '✅' : '⬜️'} ${t.title}`);
            return `Ваши задачи:\n` + lines.join('\n');
          }

          return focus.rows[0]?.text
            ? `Фокус: «${focus.rows[0].text}». Могу добавить задачи или собрать план.`
            : `Готов помочь: добавлю задачи, поставлю фокус, отмечу выполненные.`;
        }

        if (!process.env.OPENAI_API_KEY) {
          const reply = await ruleBased();
          return json(res, { a: reply });
        }

        // LLM: строгий JSON-план
        const { OpenAI } = require('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const sys = `
Ты ассистент продуктивности. Отвечай ТОЛЬКО валидным JSON строго по схеме:
{
  "reply": "короткий ответ (1-2 предложения)",
  "ops": [
    { "type": "add_task", "title": "string", "scope": "today|week|backlog", "due_at": "ISO8601|null" },
    { "type": "set_focus", "text": "string" },
    { "type": "toggle_task", "id": 123, "title": "подстрока", "done": true },
    { "type": "delete_task", "id": 123, "title": "подстрока" }
  ]
}
Если просят «добавь/создай задачу … к/до/в HH:MM», заполни due_at (сегодня, локальная зона). Если не знаешь id — оставь только title.
`.trim();
        const user = `
Запрос: ${q}
Фокус: ${focus.rows[0]?.text || '(нет)'}
Задачи (${tasks.rows.length}): ${tasks.rows.map(t => `[${t.id}] ${t.done?'✅':'⬜️'} ${t.title}`).join('; ').slice(0,3000)}
Таймзона: ${timezone}
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

        let plan = { reply:'', ops:[] };
        try { plan = JSON.parse(content); } catch {}

        // применяем операции
        async function findIdByTitle(sub) {
          const r = await pool.query(
            `select id from tasks where user_id=$1 and title ilike $2 order by done asc, id desc limit 1`,
            [me.id, `%${sub}%`]
          );
          return r.rows[0]?.id || null;
        }

        for (const op of (plan.ops || [])) {
          try {
            if (op.type === 'add_task' && op.title) {
              await pool.query(
                `insert into tasks(user_id, title, scope, due_at) values($1,$2,$3,$4)`,
                [me.id, String(op.title).slice(0,250), ['today','week','backlog'].includes(op.scope)?op.scope:'today', op.due_at? new Date(op.due_at): null]
              );
            }
            if (op.type === 'set_focus' && op.text) {
              await pool.query(
                `insert into focus(user_id, text, updated_at)
                 values($1,$2, now())
                 on conflict (user_id) do update set text=excluded.text, updated_at=now()`,
                [me.id, String(op.text).slice(0,250)]
              );
            }
            if (op.type === 'toggle_task') {
              let id = op.id || (op.title ? await findIdByTitle(op.title) : null);
              if (id) await pool.query(`update tasks set done=$1 where user_id=$2 and id=$3`, [!!op.done, me.id, id]);
            }
            if (op.type === 'delete_task') {
              let id = op.id || (op.title ? await findIdByTitle(op.title) : null);
              if (id) await pool.query(`delete from tasks where user_id=$1 and id=$2`, [me.id, id]);
            }
          } catch {}
        }

        const finalText = (plan.reply || 'Готово.').toString().slice(0,250);
        return json(res, { a: finalText });
      } catch (e) {
        return json(res, { ok:false, where:'chat', error:String(e.message||e) }, 500);
      }
    }

    /* ------------ 404 ------------ */
    return json(res, { error:'NOT_FOUND', path:parts }, 404);
  } catch (e) {
    return json(res, { ok:false, where:'top', error:String(e.message||e) }, 500);
  }
};
