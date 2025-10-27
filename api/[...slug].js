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

    /* ------------ CHAT (короткий ответ; LLM можно подключить позже) ------------ */
    if (parts[0] === 'chat' && req.method === 'POST') {
      try {
        await upsertUser(me);
        const body = await readBody(req);
        const q = (body.q || '').toString().trim();
        if (!q) return json(res, { a:'Скажи, что сделать: добавить задачу, поставить фокус, показать список.' });
        return json(res, { a:`Принял: «${q}». Могу добавить задачи и фокус.` });
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
